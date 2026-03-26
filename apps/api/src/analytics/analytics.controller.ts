import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload, UserRole } from '@qa/shared';

@ApiTags('Analytics')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'KPI summary for the period' })
  @ApiQuery({ name: 'from', type: String })
  @ApiQuery({ name: 'to', type: String })
  async overview(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.analyticsService.getOverview(
      user.tenantId,
      new Date(from ?? new Date(Date.now() - 30 * 24 * 3600_000).toISOString()),
      new Date(to ?? new Date().toISOString()),
    );
  }

  @Get('agent-performance')
  @ApiOperation({ summary: 'Per-agent score + pass rate' })
  async agentPerformance(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.analyticsService.getAgentPerformance(
      user.tenantId,
      new Date(from ?? new Date(Date.now() - 30 * 24 * 3600_000).toISOString()),
      new Date(to ?? new Date().toISOString()),
    );
  }

  @Get('deviation-trends')
  @ApiOperation({ summary: 'AI vs QA vs Verifier deviation trends by day' })
  async deviationTrends(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.analyticsService.getDeviationTrends(
      user.tenantId,
      new Date(from ?? new Date(Date.now() - 30 * 24 * 3600_000).toISOString()),
      new Date(to ?? new Date().toISOString()),
    );
  }
}
