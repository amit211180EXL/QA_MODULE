import { Controller, Get, Patch, Post, Body, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { TenantSettingsService } from './tenant-settings.service';
import {
  SendTestEmailDto,
  UpdateBlindReviewDto,
  UpdateEscalationRulesDto,
  UpdateTenantEmailSettingsDto,
} from './dto/tenant-settings.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { buildResponse } from '../common/helpers/response.helper';
import { JwtPayload, UserRole } from '@qa/shared';

@ApiTags('Tenant Settings')
@ApiBearerAuth()
@Controller('settings')
export class TenantSettingsController {
  constructor(private readonly tenantSettingsService: TenantSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all tenant settings' })
  async getSettings(@CurrentUser() user: JwtPayload) {
    return this.tenantSettingsService.getSettings(user.tenantId);
  }

  @Get('email')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get tenant email settings (Admin only)' })
  async getEmailSettings(@CurrentUser() user: JwtPayload, @Req() req: Request) {
    const result = await this.tenantSettingsService.getEmailSettings(user.tenantId);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Patch('escalation')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update escalation rules (Admin only)' })
  async updateEscalation(@CurrentUser() user: JwtPayload, @Body() dto: UpdateEscalationRulesDto) {
    return this.tenantSettingsService.upsertEscalationRules(user.tenantId, dto);
  }

  @Patch('blind-review')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update blind review settings (Admin only)' })
  async updateBlindReview(@CurrentUser() user: JwtPayload, @Body() dto: UpdateBlindReviewDto) {
    return this.tenantSettingsService.upsertBlindReview(user.tenantId, dto);
  }

  @Patch('email')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update tenant email settings (Admin only)' })
  async updateEmailSettings(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateTenantEmailSettingsDto,
    @Req() req: Request,
  ) {
    const result = await this.tenantSettingsService.upsertEmailSettings(user.tenantId, dto);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Post('email/test')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Send a test email using tenant SMTP settings (Admin only)' })
  async sendTestEmail(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SendTestEmailDto,
    @Req() req: Request,
  ) {
    const result = await this.tenantSettingsService.sendTestEmail(user.tenantId, dto.to);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Get('onboarding-status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Returns which onboarding steps have been completed' })
  async onboardingStatus(@CurrentUser() user: JwtPayload) {
    return this.tenantSettingsService.getOnboardingStatus(user.tenantId);
  }

  @Post('api-keys/rotate')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Rotate webhook API key — returns new plaintext key (shown once)' })
  async rotateApiKey(@CurrentUser() user: JwtPayload) {
    return this.tenantSettingsService.rotateApiKey(user.tenantId);
  }
}
