import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { OutboundWebhooksController } from './outbound-webhooks.controller';
import { OutboundWebhooksService } from './outbound-webhooks.service';
import { TenantModule } from '../tenant/tenant.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [TenantModule, BillingModule],
  controllers: [WebhooksController, OutboundWebhooksController],
  providers: [WebhooksService, OutboundWebhooksService],
  exports: [WebhooksService, OutboundWebhooksService],
})
export class WebhooksModule {}
