import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { getEnv } from '@qa/config';
import { QUEUE_NAMES } from '@qa/shared';
import { MetricsService } from './metrics.service';

const QUEUE_METRIC_INTERVAL_MS = 15_000;

@Injectable()
export class QueueMetricsCollectorService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(QueueMetricsCollectorService.name);
  private readonly queueNames = [QUEUE_NAMES.EVAL_PROCESS, QUEUE_NAMES.TENANT_PROVISION] as const;
  private readonly queues = new Map<string, Queue>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly metrics: MetricsService) {}

  async onApplicationBootstrap() {
    const env = getEnv();
    if (env.REDIS_ENABLED === 'false') {
      for (const queueName of this.queueNames) {
        this.metrics.setQueueDepth(queueName, { waiting: 0, active: 0, delayed: 0, failed: 0 });
        this.metrics.setQueueRecommendedReplicas(queueName, 1);
      }
      return;
    }

    for (const queueName of this.queueNames) {
      const queue = new Queue(queueName, {
        connection: {
          host: env.REDIS_HOST,
          port: env.REDIS_PORT,
          password: env.REDIS_PASSWORD,
          maxRetriesPerRequest: 1,
        },
      });
      this.queues.set(queueName, queue);
    }

    await this.pollQueueDepths();
    this.timer = setInterval(() => {
      void this.pollQueueDepths();
    }, QUEUE_METRIC_INTERVAL_MS);
  }

  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    for (const queue of this.queues.values()) {
      await queue.close().catch(() => null);
    }
    this.queues.clear();
  }

  private async pollQueueDepths() {
    const env = getEnv();

    for (const [queueName, queue] of this.queues.entries()) {
      try {
        const [waiting, active, delayed, failed] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getDelayedCount(),
          queue.getFailedCount(),
        ]);

        this.metrics.setQueueDepth(queueName, { waiting, active, delayed, failed });
        this.metrics.setQueueRecommendedReplicas(
          queueName,
          this.computeRecommendedReplicas(queueName, waiting + delayed, env),
        );
      } catch (err) {
        this.logger.warn(
          `Queue metrics poll failed for ${queueName}: ${(err as Error).message}`,
        );
      }
    }
  }

  private computeRecommendedReplicas(
    queueName: string,
    backlog: number,
    env: ReturnType<typeof getEnv>,
  ): number {
    if (queueName === QUEUE_NAMES.EVAL_PROCESS) {
      return this.clamp(
        Math.ceil(backlog / env.AUTOSCALE_EVAL_TARGET_BACKLOG_PER_REPLICA),
        env.AUTOSCALE_EVAL_MIN_REPLICAS,
        env.AUTOSCALE_EVAL_MAX_REPLICAS,
      );
    }

    if (queueName === QUEUE_NAMES.TENANT_PROVISION) {
      return this.clamp(
        Math.ceil(backlog / env.AUTOSCALE_TENANT_PROVISION_TARGET_BACKLOG_PER_REPLICA),
        env.AUTOSCALE_TENANT_PROVISION_MIN_REPLICAS,
        env.AUTOSCALE_TENANT_PROVISION_MAX_REPLICAS,
      );
    }

    return 1;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.max(1, value || 1)));
  }
}
