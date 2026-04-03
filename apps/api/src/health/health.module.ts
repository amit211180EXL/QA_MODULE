import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { MetricsService } from './metrics.service';
import { QueueMetricsCollectorService } from './queue-metrics-collector.service';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [HealthService, MetricsService, QueueMetricsCollectorService],
  exports: [MetricsService],
})
export class HealthModule {}
