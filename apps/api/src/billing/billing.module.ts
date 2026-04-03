import { Module, Global } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { UsageMeterService } from './usage-meter.service';
import { TenantModule } from '../tenant/tenant.module';

@Global()
@Module({
  imports: [TenantModule],
  controllers: [BillingController],
  providers: [BillingService, UsageMeterService],
  exports: [UsageMeterService],
})
export class BillingModule {}
