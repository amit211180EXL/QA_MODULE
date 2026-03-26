import { Module } from '@nestjs/common';
import { LlmConfigController } from './llm-config.controller';
import { LlmConfigService } from './llm-config.service';

@Module({
  controllers: [LlmConfigController],
  providers: [LlmConfigService],
  exports: [LlmConfigService],
})
export class LlmConfigModule {}
