import { Module, Global } from '@nestjs/common';
import { loadEnv } from '@qa/config';

@Global()
@Module({
  providers: [
    {
      provide: 'APP_ENV',
      useFactory: () => loadEnv(),
    },
  ],
  exports: ['APP_ENV'],
})
export class ConfigModule {}
