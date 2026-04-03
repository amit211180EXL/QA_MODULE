import { Module, Global } from '@nestjs/common';
import { TenantConnectionPool } from './tenant-connection-pool.service';
import { PoolReaperService } from './pool-reaper.service';

export const TENANT_DB = 'TENANT_DB';

@Global()
@Module({
  providers: [TenantConnectionPool, PoolReaperService],
  exports: [TenantConnectionPool],
})
export class TenantModule {}
