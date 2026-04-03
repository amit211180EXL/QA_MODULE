import { Module } from '@nestjs/common';
import { EvaluationsController } from './evaluations.controller';
import { EvaluationsService } from './evaluations.service';
import { ScoringService } from './scoring.service';
import { TenantModule } from '../tenant/tenant.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [TenantModule, WebhooksModule],
  controllers: [EvaluationsController],
  providers: [EvaluationsService, ScoringService],
  exports: [EvaluationsService, ScoringService],
})
export class EvaluationsModule {}
