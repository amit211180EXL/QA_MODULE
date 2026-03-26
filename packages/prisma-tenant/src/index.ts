import { PrismaClient } from '../generated/tenant-client';

export type TenantPrismaClient = PrismaClient;

export function createTenantClient(databaseUrl: string): TenantPrismaClient {
  return new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['warn', 'error'],
  });
}

export { PrismaClient as TenantPrismaClientClass } from '../generated/tenant-client';
export * from '../generated/tenant-client';
