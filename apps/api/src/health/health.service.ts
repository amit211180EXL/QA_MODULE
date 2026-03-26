import { Injectable, Inject } from '@nestjs/common';
import { getMasterClient } from '@qa/prisma-master';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

@Injectable()
export class HealthService {
  private readonly db = getMasterClient();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async checkLiveness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  async checkReadiness() {
    const checks: Record<string, string> = {};

    // Master DB
    try {
      await this.db.$queryRaw`SELECT 1`;
      checks['db_master'] = 'ok';
    } catch {
      checks['db_master'] = 'error';
    }

    // Redis
    try {
      await this.redis.ping();
      checks['redis'] = 'ok';
    } catch {
      checks['redis'] = 'error';
    }

    const allOk = Object.values(checks).every((v) => v === 'ok');
    return { status: allOk ? 'ok' : 'degraded', checks, timestamp: new Date().toISOString() };
  }
}
