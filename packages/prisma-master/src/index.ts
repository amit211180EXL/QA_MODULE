import { PrismaClient } from '../generated/master-client';

let _client: PrismaClient | undefined;

export function getMasterClient(): PrismaClient {
  if (!_client) {
    _client = new PrismaClient({
      log:
        process.env.NODE_ENV === 'development'
          ? ['query', 'warn', 'error']
          : ['warn', 'error'],
    });
  }
  return _client;
}

export async function disconnectMaster(): Promise<void> {
  if (_client) {
    await _client.$disconnect();
    _client = undefined;
  }
}

export { PrismaClient as MasterPrismaClient } from '../generated/master-client';
export * from '../generated/master-client';
