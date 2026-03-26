import { Controller, Get, Put, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { LlmConfigService } from './llm-config.service';
import { UpsertLlmConfigDto } from './dto/llm-config.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload, UserRole } from '@qa/shared';

@ApiTags('LLM Config')
@ApiBearerAuth()
@Controller('llm-config')
export class LlmConfigController {
  constructor(private readonly llmConfigService: LlmConfigService) {}

  @Get()
  @ApiOperation({ summary: 'Get current tenant LLM configuration' })
  async getConfig(@CurrentUser() user: JwtPayload) {
    return this.llmConfigService.getConfig(user.tenantId);
  }

  @Put()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create or update LLM configuration (Admin only)' })
  async upsertConfig(@CurrentUser() user: JwtPayload, @Body() dto: UpsertLlmConfigDto) {
    return this.llmConfigService.upsertConfig(user.tenantId, dto);
  }

  @Post('test')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Test LLM connectivity (Admin only)' })
  async testConnection(@CurrentUser() user: JwtPayload) {
    return this.llmConfigService.testConnection(user.tenantId);
  }
}
