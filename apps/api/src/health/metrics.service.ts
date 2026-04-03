import { Injectable } from '@nestjs/common';
import {
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
  register,
  Registry,
} from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly registry: Registry = register;
  private readonly requestCounter: Counter<string>;
  private readonly requestDurationMs: Histogram<string>;
  private readonly queueWaitingGauge: Gauge<string>;
  private readonly queueActiveGauge: Gauge<string>;
  private readonly queueDelayedGauge: Gauge<string>;
  private readonly queueFailedGauge: Gauge<string>;
  private readonly queueRecommendedReplicasGauge: Gauge<string>;

  constructor() {
    // Avoid duplicate registration when the app is bootstrapped repeatedly in tests.
    if (!this.registry.getSingleMetric('process_cpu_user_seconds_total')) {
      collectDefaultMetrics({ register: this.registry });
    }

    this.requestCounter =
      (this.registry.getSingleMetric('http_requests_total') as Counter<string>) ||
      new Counter({
        name: 'http_requests_total',
        help: 'Total number of HTTP requests',
        labelNames: ['method', 'route', 'status_code'] as const,
        registers: [this.registry],
      });

    this.requestDurationMs =
      (this.registry.getSingleMetric('http_request_duration_ms') as Histogram<string>) ||
      new Histogram({
        name: 'http_request_duration_ms',
        help: 'HTTP request duration in milliseconds',
        labelNames: ['method', 'route', 'status_code'] as const,
        buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
        registers: [this.registry],
      });

    this.queueWaitingGauge =
      (this.registry.getSingleMetric('queue_jobs_waiting') as Gauge<string>) ||
      new Gauge({
        name: 'queue_jobs_waiting',
        help: 'Number of waiting jobs in a queue',
        labelNames: ['queue'] as const,
        registers: [this.registry],
      });

    this.queueActiveGauge =
      (this.registry.getSingleMetric('queue_jobs_active') as Gauge<string>) ||
      new Gauge({
        name: 'queue_jobs_active',
        help: 'Number of active jobs in a queue',
        labelNames: ['queue'] as const,
        registers: [this.registry],
      });

    this.queueDelayedGauge =
      (this.registry.getSingleMetric('queue_jobs_delayed') as Gauge<string>) ||
      new Gauge({
        name: 'queue_jobs_delayed',
        help: 'Number of delayed jobs in a queue',
        labelNames: ['queue'] as const,
        registers: [this.registry],
      });

    this.queueFailedGauge =
      (this.registry.getSingleMetric('queue_jobs_failed') as Gauge<string>) ||
      new Gauge({
        name: 'queue_jobs_failed',
        help: 'Number of failed jobs in a queue',
        labelNames: ['queue'] as const,
        registers: [this.registry],
      });

    this.queueRecommendedReplicasGauge =
      (this.registry.getSingleMetric('queue_autoscale_recommended_replicas') as Gauge<string>) ||
      new Gauge({
        name: 'queue_autoscale_recommended_replicas',
        help: 'Recommended worker replicas for each queue based on backlog policy',
        labelNames: ['queue'] as const,
        registers: [this.registry],
      });
  }

  recordHttpRequest(method: string, route: string, statusCode: number, durationMs: number) {
    const labels = {
      method: method.toUpperCase(),
      route,
      status_code: String(statusCode),
    };
    this.requestCounter.inc(labels);
    this.requestDurationMs.observe(labels, durationMs);
  }

  setQueueDepth(
    queue: string,
    counts: { waiting: number; active: number; delayed: number; failed: number },
  ) {
    const labels = { queue };
    this.queueWaitingGauge.set(labels, counts.waiting);
    this.queueActiveGauge.set(labels, counts.active);
    this.queueDelayedGauge.set(labels, counts.delayed);
    this.queueFailedGauge.set(labels, counts.failed);
  }

  setQueueRecommendedReplicas(queue: string, replicas: number) {
    this.queueRecommendedReplicasGauge.set({ queue }, replicas);
  }

  async getMetricsText(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}
