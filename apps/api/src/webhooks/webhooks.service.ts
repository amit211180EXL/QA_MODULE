import {
  Injectable,
  Inject,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { getMasterClient } from '@qa/prisma-master';
import { REDIS_CLIENT } from '../redis/redis.module';
import { TenantConnectionPool } from '../tenant/tenant-connection-pool.service';
import { UsageMeterService } from '../billing/usage-meter.service';
import { PLAN_LIMITS, PlanType } from '@qa/shared';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, EvalProcessJobPayload } from '@qa/shared';
import { getEnv } from '@qa/config';
import Redis from 'ioredis';

const API_KEY_PREFIX = 'webhook_apikey:';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly masterDb = getMasterClient();
  private readonly evalQueue: Queue<EvalProcessJobPayload> | null = null;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly pool: TenantConnectionPool,
    private readonly usageMeter: UsageMeterService,
  ) {
    const env = getEnv();
    if (env.REDIS_ENABLED !== 'false') {
      this.evalQueue = new Queue(QUEUE_NAMES.EVAL_PROCESS, {
        connection: {
          host: env.REDIS_HOST,
          port: env.REDIS_PORT,
          password: env.REDIS_PASSWORD,
          maxRetriesPerRequest: 1,
          connectTimeout: 3000,
          lazyConnect: true,
        },
      });
    }
  }

  /** Hash a raw API key with SHA-256. */
  private hashKey(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex');
  }

  /** Register a new API key for a tenant (used during provisioning or from admin). */
  async registerApiKey(tenantId: string, rawKey: string, ttlSeconds = 0): Promise<void> {
    const hash = this.hashKey(rawKey);
    const redisKey = `${API_KEY_PREFIX}${hash}`;
    if (ttlSeconds > 0) {
      await this.redis.set(redisKey, tenantId, 'EX', ttlSeconds);
    } else {
      await this.redis.set(redisKey, tenantId);
    }
  }

  /** Resolve a tenant ID from a raw API key. Throws 401 if invalid. */
  async resolveTenantByApiKey(rawKey: string): Promise<string> {
    const hash = this.hashKey(rawKey);
    const tenantId = await this.redis.get(`${API_KEY_PREFIX}${hash}`);
    if (!tenantId) {
      throw new UnauthorizedException({ code: 'INVALID_API_KEY', message: 'Invalid API key' });
    }
    return tenantId;
  }

  /** Ingest conversations for a tenant — mirrors ConversationsService.uploadConversations. */
  async ingestConversations(
    tenantId: string,
    payload: {
      channel: string;
      conversations: Array<{
        externalId?: string;
        agentId?: string;
        agentName?: string;
        customerRef?: string;
        content: unknown;
        metadata?: unknown;
        receivedAt?: string;
      }>;
    },
  ) {
    const db = await this.pool.getClient(tenantId);

    // Plan limit check
    const tenant = await this.masterDb.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { plan: true },
    });
    const limits = PLAN_LIMITS[tenant.plan as PlanType];
    if (limits && limits.conversationsPerMonth !== 999_999) {
      const used = await this.usageMeter.getMonthlyConversationCount(tenantId);
      const remaining = limits.conversationsPerMonth - used;
      if (remaining <= 0) {
        throw new BadRequestException({
          code: 'PLAN_LIMIT_EXCEEDED',
          message: `Monthly conversation limit of ${limits.conversationsPerMonth} reached.`,
        });
      }
      if (payload.conversations.length > remaining) {
        throw new BadRequestException({
          code: 'PLAN_LIMIT_WOULD_EXCEED',
          message: `Upload would exceed monthly limit. ${remaining} conversations remaining.`,
        });
      }
    }

    // Find active form for channel
    const activeForm = await db.formDefinition.findFirst({
      where: {
        status: 'PUBLISHED',
        channels: { path: [], array_contains: payload.channel },
      },
      orderBy: { version: 'desc' },
      select: { id: true, version: true },
    });

    // Upsert conversations
    const created = await db.$transaction(
      payload.conversations.map((c) =>
        db.conversation.upsert({
          where: { externalId: c.externalId ?? `__wh_${Date.now()}_${Math.random()}` },
          create: {
            externalId: c.externalId,
            channel: payload.channel as never,
            agentId: c.agentId,
            agentName: c.agentName,
            customerRef: c.customerRef,
            content: c.content as never,
            metadata: c.metadata as never,
            receivedAt: c.receivedAt ? new Date(c.receivedAt) : new Date(),
          },
          update: {},
        }),
      ),
    );

    // Create evaluations + enqueue jobs
    if (activeForm) {
      for (const conv of created) {
        const existing = await db.evaluation.findUnique({ where: { conversationId: conv.id } });
        if (existing) continue;

        const evaluation = await db.evaluation.create({
          data: {
            conversationId: conv.id,
            formDefinitionId: activeForm.id,
            formVersion: activeForm.version,
            workflowState: 'AI_PENDING',
          },
        });

        if (this.evalQueue) {
          await this.evalQueue
            .add(
              'eval-process',
              { tenantId, conversationId: conv.id, evaluationId: evaluation.id, formDefinitionId: activeForm.id, formVersion: activeForm.version },
              { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
            )
            .catch((err: Error) => this.logger.warn('Enqueue failed: ' + err.message));
        }
      }
    }

    this.usageMeter.recordConversation(tenantId, created.length).catch(() => null);

    return { accepted: created.length, evaluated: activeForm ? created.length : 0 };
  }
}
