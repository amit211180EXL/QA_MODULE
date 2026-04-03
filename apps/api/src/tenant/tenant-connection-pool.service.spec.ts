// Unit tests for TenantConnectionPool
// All external dependencies (Prisma clients, Redis, decrypt) are mocked.

jest.mock('@qa/prisma-master', () => ({
  getMasterClient: jest.fn(() => mockMasterDb),
}));

jest.mock('@qa/prisma-tenant', () => ({
  createTenantClient: jest.fn(() => mockTenantClient),
}));

jest.mock('../common/utils/encryption.util', () => ({
  encrypt: jest.fn((v: string) => v),
  decrypt: jest.fn((v: string) => v),
}));

jest.mock('@qa/config', () => ({
  getEnv: jest.fn().mockReturnValue({ REDIS_ENABLED: 'false' }),
}));

// ─── Mock DB state (populated before each test) ───────────────────────────────

let mockMasterDb: {
  tenant: { findUnique: jest.Mock };
};

let mockTenantClient: {
  $connect: jest.Mock;
  $disconnect: jest.Mock;
};

// ─────────────────────────────────────────────────────────────────────────────

import { TenantConnectionPool } from './tenant-connection-pool.service';
import { PlanType } from '@qa/shared';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function activeTenant(plan: PlanType = PlanType.PRO) {
  return {
    dbHost: 'localhost',
    dbPort: 5432,
    dbName: 'qa_tenant_abc',
    dbUser: 'qa_user_abc',
    dbPasswordEnc: 'PLAINTEXT:testpassword', // dev plaintext path avoids decrypt
    plan,
    status: 'ACTIVE',
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('TenantConnectionPool', () => {
  let pool: TenantConnectionPool;
  let mockRedis: { set: jest.Mock; del: jest.Mock; get: jest.Mock };

  beforeEach(() => {
    mockMasterDb = {
      tenant: { findUnique: jest.fn() },
    };

    mockTenantClient = {
      $connect: jest.fn().mockResolvedValue(undefined),
      $disconnect: jest.fn().mockResolvedValue(undefined),
    };

    mockRedis = { set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1), get: jest.fn() };

    pool = new TenantConnectionPool(mockRedis as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── getClient — first access creates and caches ──────────────────────────

  describe('getClient', () => {
    it('connects to the DB and returns the client on first call', async () => {
      mockMasterDb.tenant.findUnique.mockResolvedValue(activeTenant());

      const client = await pool.getClient('tenant-1');

      expect(client).toBe(mockTenantClient);
      expect(mockTenantClient.$connect).toHaveBeenCalledTimes(1);
    });

    it('caches — second call does NOT create a new client or connect again', async () => {
      mockMasterDb.tenant.findUnique.mockResolvedValue(activeTenant());

      const c1 = await pool.getClient('tenant-1');
      const c2 = await pool.getClient('tenant-1');

      expect(c1).toBe(c2);
      // $connect called once (not twice)
      expect(mockTenantClient.$connect).toHaveBeenCalledTimes(1);
      // Master DB only queried once
      expect(mockMasterDb.tenant.findUnique).toHaveBeenCalledTimes(1);
    });

    it('updates Redis TTL on cache hit', async () => {
      mockMasterDb.tenant.findUnique.mockResolvedValue(activeTenant());

      await pool.getClient('tenant-1'); // populates cache
      mockRedis.set.mockClear();
      await pool.getClient('tenant-1'); // cache hit

      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining('tenant-1'),
        expect.any(String),
        'EX',
        expect.any(Number),
      );
    });

    it('throws when tenant is not found in master DB', async () => {
      mockMasterDb.tenant.findUnique.mockResolvedValue(null);

      await expect(pool.getClient('unknown-tenant')).rejects.toThrow('not found or not active');
    });

    it('throws when tenant status is not ACTIVE', async () => {
      mockMasterDb.tenant.findUnique.mockResolvedValue({
        ...activeTenant(),
        status: 'PROVISIONING',
      });

      await expect(pool.getClient('tenant-pending')).rejects.toThrow('not found or not active');
    });

    it('uses PLAINTEXT: prefix password without calling decrypt', async () => {
      const { decrypt } = require('../common/utils/encryption.util');
      mockMasterDb.tenant.findUnique.mockResolvedValue(activeTenant());

      await pool.getClient('tenant-1');

      expect(decrypt).not.toHaveBeenCalled();
    });

    it('calls decrypt for non-plaintext encrypted password', async () => {
      const { decrypt } = require('../common/utils/encryption.util');
      (decrypt as jest.Mock).mockReturnValue('decrypted-password');
      mockMasterDb.tenant.findUnique.mockResolvedValue({
        ...activeTenant(),
        dbPasswordEnc: 'base64encryptedblob',
      });

      await pool.getClient('tenant-enc');

      expect(decrypt).toHaveBeenCalledWith('base64encryptedblob');
    });

    it('stores the new pool entry in Redis', async () => {
      mockMasterDb.tenant.findUnique.mockResolvedValue(activeTenant());

      await pool.getClient('tenant-1');

      expect(mockRedis.set).toHaveBeenCalledWith(
        'pool:tenant:tenant-1',
        expect.any(String),
        'EX',
        expect.any(Number),
      );
    });

    it('isolates clients per tenant (different tenantIds get different entries)', async () => {
      const { createTenantClient } = require('@qa/prisma-tenant');
      const client1 = { $connect: jest.fn().mockResolvedValue(undefined), $disconnect: jest.fn() };
      const client2 = { $connect: jest.fn().mockResolvedValue(undefined), $disconnect: jest.fn() };
      (createTenantClient as jest.Mock)
        .mockReturnValueOnce(client1)
        .mockReturnValueOnce(client2);

      mockMasterDb.tenant.findUnique
        .mockResolvedValueOnce(activeTenant())
        .mockResolvedValueOnce({ ...activeTenant(), dbName: 'qa_tenant_different' });

      const c1 = await pool.getClient('tenant-A');
      const c2 = await pool.getClient('tenant-B');

      expect(c1).toBe(client1);
      expect(c2).toBe(client2);
      expect(c1).not.toBe(c2);
    });
  });

  // ─── activePoolCount ──────────────────────────────────────────────────────

  describe('activePoolCount', () => {
    it('starts at 0', () => {
      expect(pool.activePoolCount).toBe(0);
    });

    it('increments when a new pool is created', async () => {
      mockMasterDb.tenant.findUnique.mockResolvedValue(activeTenant());
      await pool.getClient('tenant-1');
      expect(pool.activePoolCount).toBe(1);
    });
  });

  // ─── evictPool ────────────────────────────────────────────────────────────

  describe('evictPool', () => {
    it('disconnects the client and removes the pool entry', async () => {
      mockMasterDb.tenant.findUnique.mockResolvedValue(activeTenant());
      await pool.getClient('tenant-1');

      await pool.evictPool('tenant-1');

      expect(mockTenantClient.$disconnect).toHaveBeenCalledTimes(1);
      expect(pool.activePoolCount).toBe(0);
    });

    it('removes the Redis key on eviction', async () => {
      mockMasterDb.tenant.findUnique.mockResolvedValue(activeTenant());
      await pool.getClient('tenant-1');

      await pool.evictPool('tenant-1');

      expect(mockRedis.del).toHaveBeenCalledWith('pool:tenant:tenant-1');
    });

    it('is a no-op when the pool entry does not exist', async () => {
      await expect(pool.evictPool('ghost-tenant')).resolves.not.toThrow();
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('after eviction a subsequent getClient creates a fresh connection', async () => {
      mockMasterDb.tenant.findUnique.mockResolvedValue(activeTenant());

      await pool.getClient('tenant-1');
      await pool.evictPool('tenant-1');

      // Re-fetch
      await pool.getClient('tenant-1');

      // $connect should have been called twice
      expect(mockTenantClient.$connect).toHaveBeenCalledTimes(2);
    });
  });

  // ─── reapIdlePools ────────────────────────────────────────────────────────

  describe('reapIdlePools', () => {
    it('evicts pools idle longer than the threshold and returns count', async () => {
      mockMasterDb.tenant.findUnique.mockResolvedValue(activeTenant());
      await pool.getClient('tenant-idle');

      // Simulate idleness by reaching into the private map and backdating `lastUsed`
      const pools = (pool as any).pools as Map<string, { client: unknown; lastUsed: number }>;
      pools.get('tenant-idle')!.lastUsed = Date.now() - 60 * 60 * 1000; // 1 hour ago

      const reaped = await pool.reapIdlePools(30 * 60 * 1000); // 30 min threshold

      expect(reaped).toBe(1);
      expect(pool.activePoolCount).toBe(0);
    });

    it('does NOT evict pools that are still within the idle threshold', async () => {
      mockMasterDb.tenant.findUnique.mockResolvedValue(activeTenant());
      await pool.getClient('tenant-fresh');

      const reaped = await pool.reapIdlePools(30 * 60 * 1000);

      expect(reaped).toBe(0);
      expect(pool.activePoolCount).toBe(1);
    });

    it('returns 0 when no pools exist', async () => {
      const reaped = await pool.reapIdlePools(30 * 60 * 1000);
      expect(reaped).toBe(0);
    });

    it('evicts only idle pools, preserves active ones', async () => {
      const { createTenantClient } = require('@qa/prisma-tenant');
      const clientA = { $connect: jest.fn().mockResolvedValue(undefined), $disconnect: jest.fn().mockResolvedValue(undefined) };
      const clientB = { $connect: jest.fn().mockResolvedValue(undefined), $disconnect: jest.fn().mockResolvedValue(undefined) };
      (createTenantClient as jest.Mock)
        .mockReturnValueOnce(clientA)
        .mockReturnValueOnce(clientB);
      mockMasterDb.tenant.findUnique.mockResolvedValue(activeTenant());

      await pool.getClient('tenant-old');
      await pool.getClient('tenant-new');

      const pools = (pool as any).pools as Map<string, { client: unknown; lastUsed: number }>;
      pools.get('tenant-old')!.lastUsed = Date.now() - 60 * 60 * 1000; // 1 hr ago — stale
      // tenant-new was just accessed — should survive

      const reaped = await pool.reapIdlePools(30 * 60 * 1000);

      expect(reaped).toBe(1);
      expect(pool.activePoolCount).toBe(1);
    });
  });

  // ─── onApplicationShutdown ────────────────────────────────────────────────

  describe('onApplicationShutdown', () => {
    it('disconnects all active pools', async () => {
      const { createTenantClient } = require('@qa/prisma-tenant');
      const clientX = { $connect: jest.fn().mockResolvedValue(undefined), $disconnect: jest.fn().mockResolvedValue(undefined) };
      const clientY = { $connect: jest.fn().mockResolvedValue(undefined), $disconnect: jest.fn().mockResolvedValue(undefined) };
      (createTenantClient as jest.Mock)
        .mockReturnValueOnce(clientX)
        .mockReturnValueOnce(clientY);
      mockMasterDb.tenant.findUnique.mockResolvedValue(activeTenant());

      await pool.getClient('tenant-X');
      await pool.getClient('tenant-Y');

      await pool.onApplicationShutdown();

      expect(clientX.$disconnect).toHaveBeenCalledTimes(1);
      expect(clientY.$disconnect).toHaveBeenCalledTimes(1);
      expect(pool.activePoolCount).toBe(0);
    });
  });
});
