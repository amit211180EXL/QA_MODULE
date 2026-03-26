import { Module, Global, OnApplicationShutdown } from '@nestjs/common';
import { getMasterClient, disconnectMaster } from '@qa/prisma-master';

@Global()
@Module({
  providers: [
    {
      provide: 'MASTER_DB',
      useFactory: () => getMasterClient(),
    },
  ],
  exports: ['MASTER_DB'],
})
export class DatabaseModule implements OnApplicationShutdown {
  async onApplicationShutdown() {
    await disconnectMaster();
  }
}
