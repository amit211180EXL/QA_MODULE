import { Injectable, OnApplicationBootstrap, OnApplicationShutdown, Logger } from '@nestjs/common';
import { TenantConnectionPool } from './tenant-connection-pool.service';

const REAP_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes
const IDLE_THRESHOLD_MS = 30 * 60 * 1000; // evict if idle for 30 minutes

@Injectable()
export class PoolReaperService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PoolReaperService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly pool: TenantConnectionPool) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.reap(), REAP_INTERVAL_MS);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async reap(): Promise<number> {
    const count = await this.pool.reapIdlePools(IDLE_THRESHOLD_MS);
    if (count > 0) {
      this.logger.log(`Pool reaper evicted ${count} idle tenant connection(s)`);
    }
    return count;
  }
}
