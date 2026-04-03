import { Module } from '@nestjs/common';
import { NotifyService } from './notify.service';
import { TenantEmailDeliveryService } from './tenant-email-delivery.service';

@Module({
  providers: [TenantEmailDeliveryService, NotifyService],
  exports: [NotifyService, TenantEmailDeliveryService],
})
export class NotifyModule {}
