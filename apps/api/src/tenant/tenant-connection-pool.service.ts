import { Injectable, Inject, OnApplicationShutdown, Logger } from '@nestjs/common';
import { createTenantClient, TenantPrismaClient } from '@qa/prisma-tenant';
import { getMasterClient } from '@qa/prisma-master';
import { getEnv } from '@qa/config';

import { decrypt } from '../common/utils/encryption.util';
import { PLAN_LIMITS, PlanType } from '@qa/shared';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

const POOL_CACHE_PREFIX = 'pool:tenant:';
const POOL_TTL_S = 3600; // 1 hour

interface PoolEntry {
  client: TenantPrismaClient;
  lastUsed: number;
}

@Injectable()
export class TenantConnectionPool implements OnApplicationShutdown {
  private readonly logger = new Logger(TenantConnectionPool.name);
  private readonly pools = new Map<string, PoolEntry>();
  private readonly readPools = new Map<string, PoolEntry>();
  private readonly masterDb = getMasterClient();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async getClient(tenantId: string): Promise<TenantPrismaClient> {
    // 1. Check in-process pool
    const existing = this.pools.get(tenantId);
    if (existing) {
      existing.lastUsed = Date.now();
      // Fire-and-forget — no need to block the request on a Redis touch.
      this.redis.set(
        `${POOL_CACHE_PREFIX}${tenantId}`,
        Date.now().toString(),
        'EX',
        POOL_TTL_S,
      ).catch(() => null);
      return existing.client;
    }

    // 2. Fetch tenant DB config from master DB
    const tenant = await this.masterDb.tenant.findUnique({
      where: { id: tenantId },
      select: {
        dbHost: true,
        dbPort: true,
        dbName: true,
        dbUser: true,
        dbPasswordEnc: true,
        plan: true,
        status: true,
      },
    });

    if (!tenant || tenant.status !== 'ACTIVE') {
      throw new Error(`Tenant ${tenantId} not found or not active`);
    }

    // 3. Decrypt password
    let dbPassword: string;
    if (tenant.dbPasswordEnc.startsWith('PLAINTEXT:')) {
      // Dev-only plaintext fallback
      dbPassword = tenant.dbPasswordEnc.replace('PLAINTEXT:', '');
    } else {
      dbPassword = decrypt(tenant.dbPasswordEnc);
    }

    const databaseUrl = `postgresql://${tenant.dbUser}:${encodeURIComponent(dbPassword)}@${tenant.dbHost}:${tenant.dbPort}/${tenant.dbName}`;

    // 4. Create client with plan-based pool size
    const poolSize = PLAN_LIMITS[tenant.plan as PlanType]?.dbPoolSize ?? 2;
    const client = createTenantClient(
      `${databaseUrl}?connection_limit=${poolSize}&pool_timeout=10`,
    );

    // 5. Test connection
    await client.$connect();

    this.pools.set(tenantId, { client, lastUsed: Date.now() });
    await this.redis.set(
      `${POOL_CACHE_PREFIX}${tenantId}`,
      Date.now().toString(),
      'EX',
      POOL_TTL_S,
    );

    this.logger.log(
      `Created new DB pool for tenant ${tenantId} (plan: ${tenant.plan}, pool: ${poolSize})`,
    );
    return client;
  }

  async getReadClient(tenantId: string): Promise<TenantPrismaClient> {
    const env = getEnv();
    if (!env.TENANT_READ_DB_HOST) {
      return this.getClient(tenantId);
    }

    const existing = this.readPools.get(tenantId);
    if (existing) {
      existing.lastUsed = Date.now();
      this.redis.set(
        `${POOL_CACHE_PREFIX}read:${tenantId}`,
        Date.now().toString(),
        'EX',
        POOL_TTL_S,
      ).catch(() => null);
      return existing.client;
    }

    const tenant = await this.masterDb.tenant.findUnique({
      where: { id: tenantId },
      select: {
        dbName: true,
        dbUser: true,
        dbPasswordEnc: true,
        plan: true,
        status: true,
      },
    });

    if (!tenant || tenant.status !== 'ACTIVE') {
      throw new Error(`Tenant ${tenantId} not found or not active`);
    }

    let dbPassword: string;
    if (tenant.dbPasswordEnc.startsWith('PLAINTEXT:')) {
      dbPassword = tenant.dbPasswordEnc.replace('PLAINTEXT:', '');
    } else {
      dbPassword = decrypt(tenant.dbPasswordEnc);
    }

    const poolSize = PLAN_LIMITS[tenant.plan as PlanType]?.dbPoolSize ?? 2;
    const readDatabaseUrl = `postgresql://${tenant.dbUser}:${encodeURIComponent(dbPassword)}@${env.TENANT_READ_DB_HOST}:${env.TENANT_READ_DB_PORT}/${tenant.dbName}`;

    const client = createTenantClient(
      `${readDatabaseUrl}?connection_limit=${poolSize}&pool_timeout=10`,
    );

    try {
      await client.$connect();
      this.readPools.set(tenantId, { client, lastUsed: Date.now() });
      await this.redis.set(
        `${POOL_CACHE_PREFIX}read:${tenantId}`,
        Date.now().toString(),
        'EX',
        POOL_TTL_S,
      );
      return client;
    } catch (err) {
      await client.$disconnect().catch(() => null);
      this.logger.warn(
        `Read replica unavailable for tenant ${tenantId}, falling back to primary: ${(err as Error).message}`,
      );
      return this.getClient(tenantId);
    }
  }

  async evictPool(tenantId: string): Promise<void> {
    const entry = this.pools.get(tenantId);
    if (entry) {
      await entry.client.$disconnect().catch(() => null);
      this.pools.delete(tenantId);
      await this.redis.del(`${POOL_CACHE_PREFIX}${tenantId}`);
      this.logger.log(`Evicted DB pool for tenant ${tenantId}`);
    }

    const readEntry = this.readPools.get(tenantId);
    if (readEntry) {
      await readEntry.client.$disconnect().catch(() => null);
      this.readPools.delete(tenantId);
      await this.redis.del(`${POOL_CACHE_PREFIX}read:${tenantId}`);
      this.logger.log(`Evicted read DB pool for tenant ${tenantId}`);
    }
  }

  async reapIdlePools(idleThresholdMs = 30 * 60 * 1000): Promise<number> {
    const now = Date.now();
    let reaped = 0;
    for (const [tenantId, entry] of this.pools.entries()) {
      if (now - entry.lastUsed > idleThresholdMs) {
        await this.evictPool(tenantId);
        reaped++;
      }
    }
    return reaped;
  }

  get activePoolCount(): number {
    return this.pools.size + this.readPools.size;
  }

  async onApplicationShutdown() {
    for (const [tenantId] of this.pools.entries()) {
      await this.evictPool(tenantId);
    }
  }
}
