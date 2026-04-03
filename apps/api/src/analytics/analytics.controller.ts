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

  @Get('question-deviations')
  @ApiOperation({ summary: 'Most-overridden questions by QA reviewers' })
  async questionDeviations(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.analyticsService.getQuestionDeviations(
      user.tenantId,
      new Date(from ?? new Date(Date.now() - 30 * 24 * 3600_000).toISOString()),
      new Date(to ?? new Date().toISOString()),
    );
  }

  @Get('escalation-stats')
  @ApiOperation({ summary: 'Escalation counts for the period' })
  async escalationStats(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.analyticsService.getEscalationStats(
      user.tenantId,
      new Date(from ?? new Date(Date.now() - 30 * 24 * 3600_000).toISOString()),
      new Date(to ?? new Date().toISOString()),
    );
  }

  @Get('verifier-overrides')
  @ApiOperation({ summary: 'Questions most overridden by verifiers (QA vs Verifier)' })
  async verifierOverrides(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.analyticsService.getVerifierOverrides(
      user.tenantId,
      new Date(from ?? new Date(Date.now() - 30 * 24 * 3600_000).toISOString()),
      new Date(to ?? new Date().toISOString()),
    );
  }

  @Get('rejection-reasons')
  @ApiOperation({ summary: 'Common verifier rejection reasons' })
  async rejectionReasons(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.analyticsService.getRejectionReasons(
      user.tenantId,
      new Date(from ?? new Date(Date.now() - 30 * 24 * 3600_000).toISOString()),
      new Date(to ?? new Date().toISOString()),
    );
  }

  @Get('score-trends')
  @ApiOperation({ summary: 'Daily avg score + pass rate, plus breakdown by channel' })
  async scoreTrends(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.analyticsService.getScoreTrends(
      user.tenantId,
      new Date(from ?? new Date(Date.now() - 30 * 24 * 3600_000).toISOString()),
      new Date(to ?? new Date().toISOString()),
    );
  }

  @Get('ai-usage-trends')
  @ApiOperation({ summary: 'Monthly AI token + cost trends from usage metrics' })
  async aiUsageTrends(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.analyticsService.getAiUsageTrends(
      user.tenantId,
      new Date(from ?? new Date(Date.now() - 365 * 24 * 3600_000).toISOString()),
      new Date(to ?? new Date().toISOString()),
    );
  }

  @Get('qa-reviewer-performance')
  @ApiOperation({ summary: 'Per-QA-reviewer: evaluations reviewed, avg score, turnaround' })
  async qaReviewerPerformance(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.analyticsService.getQaReviewerPerformance(
      user.tenantId,
      new Date(from ?? new Date(Date.now() - 30 * 24 * 3600_000).toISOString()),
      new Date(to ?? new Date().toISOString()),
    );
  }

  @Get('verifier-report')
  @ApiOperation({ summary: 'Per-verifier: verified count, rejected count, avg score' })
  async verifierReport(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.analyticsService.getVerifierReport(
      user.tenantId,
      new Date(from ?? new Date(Date.now() - 30 * 24 * 3600_000).toISOString()),
      new Date(to ?? new Date().toISOString()),
    );
  }

  @Get('conversation-volume')
  @ApiOperation({ summary: 'Daily conversation upload + evaluation creation counts' })
  async conversationVolume(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.analyticsService.getConversationVolume(
      user.tenantId,
      new Date(from ?? new Date(Date.now() - 30 * 24 * 3600_000).toISOString()),
      new Date(to ?? new Date().toISOString()),
    );
  }

  @Get('sla-report')
  @ApiOperation({ summary: 'Turnaround time from conversation upload to evaluation locked' })
  async slaReport(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.analyticsService.getSlaReport(
      user.tenantId,
      new Date(from ?? new Date(Date.now() - 30 * 24 * 3600_000).toISOString()),
      new Date(to ?? new Date().toISOString()),
    );
  }

  @Get('form-score-distribution')
  @ApiOperation({ summary: 'Score distribution per form (10% buckets)' })
  async formScoreDistribution(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.analyticsService.getFormScoreDistribution(
      user.tenantId,
      new Date(from ?? new Date(Date.now() - 30 * 24 * 3600_000).toISOString()),
      new Date(to ?? new Date().toISOString()),
    );
  }
}
