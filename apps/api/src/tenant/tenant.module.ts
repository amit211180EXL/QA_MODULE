import { Module, Global } from '@nestjs/common';
import { TenantConnectionPool } from './tenant-connection-pool.service';

export const TENANT_DB = 'TENANT_DB';

@Global()
@Module({
  providers: [TenantConnectionPool],
  exports: [TenantConnectionPool],
})
export class TenantModule {}
