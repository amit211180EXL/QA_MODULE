import { Module } from '@nestjs/common';
import { EvaluationsController } from './evaluations.controller';
import { EvaluationsService } from './evaluations.service';
import { ScoringService } from './scoring.service';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [TenantModule],
  controllers: [EvaluationsController],
  providers: [EvaluationsService, ScoringService],
  exports: [EvaluationsService, ScoringService],
})
export class EvaluationsModule {}
