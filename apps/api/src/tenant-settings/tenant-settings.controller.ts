import { Controller, Get, Patch, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TenantSettingsService } from './tenant-settings.service';
import { UpdateEscalationRulesDto, UpdateBlindReviewDto } from './dto/tenant-settings.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload, UserRole } from '@qa/shared';

@ApiTags('Tenant Settings')
@ApiBearerAuth()
@Controller('api/v1/settings')
export class TenantSettingsController {
  constructor(private readonly tenantSettingsService: TenantSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all tenant settings' })
  async getSettings(@CurrentUser() user: JwtPayload) {
    return this.tenantSettingsService.getSettings(user.tenantId);
  }

  @Patch('escalation')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update escalation rules (Admin only)' })
  async updateEscalation(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateEscalationRulesDto,
  ) {
    return this.tenantSettingsService.upsertEscalationRules(user.tenantId, dto);
  }

  @Patch('blind-review')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update blind review settings (Admin only)' })
  async updateBlindReview(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateBlindReviewDto,
  ) {
    return this.tenantSettingsService.upsertBlindReview(user.tenantId, dto);
  }
}
