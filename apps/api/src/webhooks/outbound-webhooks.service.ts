import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import { getMasterClient } from '@qa/prisma-master';
import { encrypt, decrypt } from '../common/utils/encryption.util';

export type WebhookEvent =
  | 'evaluation.completed'
  | 'evaluation.escalated'
  | 'evaluation.failed';

export interface WebhookPayload {
  event: WebhookEvent;
  tenantId: string;
  evaluationId: string;
  conversationId: string;
  workflowState: string;
  finalScore?: number | null;
  passFail?: boolean | null;
  timestamp: string;
}

type DeliveryStatus = 'PENDING' | 'DELIVERED' | 'FAILED';

const TIMEOUT_MS = 5_000;
const ALL_EVENTS: WebhookEvent[] = [
  'evaluation.completed',
  'evaluation.escalated',
  'evaluation.failed',
];

@Injectable()
export class OutboundWebhooksService {
  private readonly logger = new Logger(OutboundWebhooksService.name);
  private readonly db = getMasterClient();

  // ─── Management ────────────────────────────────────────────────────────────

  async create(tenantId: string, url: string, events: WebhookEvent[]) {
    this.validateUrl(url);
    this.validateEvents(events);

    const rawSecret = randomBytes(32).toString('hex');
    const secretEnc = encrypt(rawSecret);

    const hook = await this.db.outboundWebhook.create({
      data: { tenantId, url, secretEnc, events },
      select: { id: true, url: true, events: true, status: true, createdAt: true },
    });

    // Return secret once on creation — never exposed again
    return { ...hook, secret: rawSecret };
  }

  async list(tenantId: string) {
    return this.db.outboundWebhook.findMany({
      where: { tenantId },
      select: { id: true, url: true, events: true, status: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(tenantId: string, id: string, status: 'ACTIVE' | 'INACTIVE') {
    const hook = await this.db.outboundWebhook.findFirst({ where: { id, tenantId } });
    if (!hook) throw new NotFoundException({ code: 'WEBHOOK_NOT_FOUND', message: 'Webhook not found' });

    return this.db.outboundWebhook.update({
      where: { id },
      data: { status },
      select: { id: true, url: true, events: true, status: true },
    });
  }

  async remove(tenantId: string, id: string) {
    const hook = await this.db.outboundWebhook.findFirst({ where: { id, tenantId } });
    if (!hook) throw new NotFoundException({ code: 'WEBHOOK_NOT_FOUND', message: 'Webhook not found' });
    await this.db.outboundWebhook.delete({ where: { id } });
  }

  async rotateSecret(tenantId: string, id: string) {
    const hook = await this.db.outboundWebhook.findFirst({ where: { id, tenantId } });
    if (!hook) throw new NotFoundException({ code: 'WEBHOOK_NOT_FOUND', message: 'Webhook not found' });

    const rawSecret = randomBytes(32).toString('hex');
    const secretEnc = encrypt(rawSecret);

    await this.db.outboundWebhook.update({ where: { id }, data: { secretEnc } });
    return { secret: rawSecret };
  }

  async listDeliveries(
    tenantId: string,
    page = 1,
    limit = 50,
    webhookId?: string,
    status?: DeliveryStatus,
  ) {
    const skip = (page - 1) * limit;
    const where = {
      tenantId,
      ...(webhookId ? { webhookId } : {}),
      ...(status ? { status } : {}),
    };

    const [items, total] = await this.db.$transaction([
      this.db.outboundWebhookDelivery.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          webhookId: true,
          tenantId: true,
          event: true,
          status: true,
          attemptCount: true,
          httpStatus: true,
          errorMessage: true,
          deliveredAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.db.outboundWebhookDelivery.count({ where }),
    ]);

    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async retryDelivery(tenantId: string, deliveryId: string) {
    const delivery = await this.db.outboundWebhookDelivery.findFirst({
      where: { id: deliveryId, tenantId },
      include: { webhook: true },
    });
    if (!delivery) {
      throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found' });
    }

    const payload = delivery.payload as unknown as WebhookPayload;
    const secret = decrypt(delivery.webhook.secretEnc);

    try {
      const httpStatus = await this.deliverOne(delivery.webhook.url, secret, payload);
      await this.db.outboundWebhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'DELIVERED',
          attemptCount: { increment: 1 },
          httpStatus,
          errorMessage: null,
          deliveredAt: new Date(),
        },
      });
      return { id: delivery.id, status: 'DELIVERED' };
    } catch (err: unknown) {
      await this.db.outboundWebhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'FAILED',
          attemptCount: { increment: 1 },
          errorMessage: (err as Error).message,
        },
      });
      throw new BadRequestException({
        code: 'DELIVERY_RETRY_FAILED',
        message: `Retry failed: ${(err as Error).message}`,
      });
    }
  }

  // ─── Delivery ──────────────────────────────────────────────────────────────

  /**
   * Fire-and-forget delivery to all active subscriptions for the tenant that
   * match the given event. Errors are logged but never thrown.
   */
  deliver(tenantId: string, event: WebhookEvent, data: Omit<WebhookPayload, 'event' | 'tenantId' | 'timestamp'>): void {
    this.db.outboundWebhook
      .findMany({ where: { tenantId, status: 'ACTIVE' } })
      .then((hooks) => {
        const matching = hooks.filter((h) => h.events.includes(event));
        for (const hook of matching) {
          const payload: WebhookPayload = {
            event,
            tenantId,
            timestamp: new Date().toISOString(),
            ...data,
          };
          this.deliverWithLogging(hook.id, hook.url, decrypt(hook.secretEnc), payload).catch(
            (err: Error) => {
              this.logger.warn(`Outbound webhook delivery failed [${hook.id}] → ${hook.url}: ${err.message}`);
            },
          );
        }
      })
      .catch((err: Error) => {
        this.logger.error(`Failed to query outbound webhooks for tenant ${tenantId}: ${err.message}`);
      });
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async deliverWithLogging(
    webhookId: string,
    url: string,
    secret: string,
    payload: WebhookPayload,
  ): Promise<void> {
    const delivery = await this.db.outboundWebhookDelivery.create({
      data: {
        webhookId,
        tenantId: payload.tenantId,
        event: payload.event,
        payload: payload as never,
        status: 'PENDING',
      },
      select: { id: true },
    });

    try {
      const httpStatus = await this.deliverOne(url, secret, payload);
      await this.db.outboundWebhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'DELIVERED',
          httpStatus,
          deliveredAt: new Date(),
          errorMessage: null,
        },
      });
    } catch (err: unknown) {
      await this.db.outboundWebhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'FAILED',
          errorMessage: (err as Error).message,
        },
      });
      throw err;
    }
  }

  private async deliverOne(url: string, secret: string, payload: WebhookPayload): Promise<number> {
    const body = JSON.stringify(payload);
    const signature = this.sign(body, secret);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-QA-Signature': signature,
          'X-QA-Event': payload.event,
          'User-Agent': 'QA-Platform/1.0',
        },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res.status;
    } finally {
      clearTimeout(timer);
    }
  }

  private sign(body: string, secret: string): string {
    return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  }

  private validateUrl(url: string) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Only http/https URLs are allowed');
      }
    } catch {
      throw new BadRequestException({ code: 'INVALID_URL', message: 'Webhook URL must be a valid http/https URL' });
    }
  }

  private validateEvents(events: WebhookEvent[]) {
    if (!events || events.length === 0) {
      throw new BadRequestException({ code: 'INVALID_EVENTS', message: 'At least one event must be specified' });
    }
    const invalid = events.filter((e) => !(ALL_EVENTS as string[]).includes(e));
    if (invalid.length) {
      throw new BadRequestException({
        code: 'INVALID_EVENTS',
        message: `Unknown events: ${invalid.join(', ')}. Valid events: ${ALL_EVENTS.join(', ')}`,
      });
    }
  }
}
