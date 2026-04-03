import { Injectable, OnApplicationBootstrap, OnApplicationShutdown, Logger } from '@nestjs/common';
import { getMasterClient } from '@qa/prisma-master';
import { TenantConnectionPool } from '../tenant/tenant-connection-pool.service';
import { OutboundWebhooksService } from '../webhooks/outbound-webhooks.service';

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes

@Injectable()
export class StaleQueueEscalationService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(StaleQueueEscalationService.name);
  private readonly masterDb = getMasterClient();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly pool: TenantConnectionPool,
    private readonly outboundWebhooks: OutboundWebhooksService,
  ) {}

  onApplicationBootstrap() {
    // Run once at startup then on interval
    void this.runCheck();
    this.timer = setInterval(() => void this.runCheck(), CHECK_INTERVAL_MS);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private async runCheck() {
    try {
      // Find all active tenants
      const tenants = await this.masterDb.tenant.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true },
      });

      for (const { id: tenantId } of tenants) {
        await this.escalateStaleItems(tenantId).catch((err: Error) => {
          this.logger.warn(`Stale escalation failed for tenant ${tenantId}: ${err.message}`);
        });
      }
    } catch (err) {
      this.logger.error('Stale queue check error', (err as Error).message);
    }
  }

  private async escalateStaleItems(tenantId: string) {
    const db = await this.pool.getClient(tenantId);

    // Get the configured stale threshold from master DB escalation rules
    const rule = await this.masterDb.escalationRule.findFirst({
      where: { tenantId },
      select: { staleQueueHours: true },
    });
    const staleHours = rule?.staleQueueHours ?? 24;
    const staleThreshold = new Date(Date.now() - staleHours * 3600 * 1000);

    // Find QA/VERIFIER queue items past their dueBy or created before threshold
    const staleItems = await db.workflowQueue.findMany({
      where: {
        queueType: { in: ['QA_QUEUE', 'VERIFIER_QUEUE'] },
        OR: [
          { dueBy: { lt: new Date() } },
          { dueBy: null, createdAt: { lt: staleThreshold } },
        ],
      },
      select: {
        id: true,
        evaluationId: true,
        queueType: true,
        createdAt: true,
        evaluation: {
          select: { id: true, conversationId: true, workflowState: true, isEscalated: true },
        },
      },
    });

    if (staleItems.length === 0) return;

    this.logger.log(
      `[${tenantId}] Found ${staleItems.length} stale queue item(s), escalating…`,
    );

    for (const item of staleItems) {
      if (item.evaluation.isEscalated) continue;

      await db.$transaction([
        db.workflowQueue.update({
          where: { id: item.id },
          data: { queueType: 'ESCALATION_QUEUE', priority: 1 },
        }),
        db.evaluation.update({
          where: { id: item.evaluationId },
          data: {
            isEscalated: true,
            escalationReason: `Stale in ${item.queueType.replace('_', ' ').toLowerCase()} for ${staleHours}+ hours`,
          },
        }),
        db.auditLog.create({
          data: {
            evaluationId: item.evaluationId,
            entityType: 'evaluation',
            entityId: item.evaluationId,
            action: 'stale_escalation',
            actorId: 'system',
            actorRole: 'SYSTEM',
            metadata: {
              originalQueue: item.queueType,
              staleHours,
              createdAt: item.createdAt.toISOString(),
            } as never,
          },
        }),
      ]);  

      this.outboundWebhooks.deliver(tenantId, 'evaluation.escalated', {
        evaluationId: item.evaluationId,
        conversationId: item.evaluation.conversationId,
        workflowState: 'ESCALATION_QUEUE',
        finalScore: null,
        passFail: null,
      });
    }

    this.logger.log(`[${tenantId}] Escalated ${staleItems.length} stale item(s)`);
  }
}
