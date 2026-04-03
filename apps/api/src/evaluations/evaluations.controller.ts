import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { EvaluationsService } from './evaluations.service';
import {
  ListEvaluationsDto,
  QaSubmitDto,
  VerifierModifyDto,
  VerifierRejectDto,
  PreviewScoreDto,
  ManualAssignDto,
  BulkRoundRobinDto,
  ReassignDto,
} from './dto/evaluations.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload, UserRole } from '@qa/shared';
import { buildResponse } from '../common/helpers/response.helper';

@ApiTags('Evaluations')
@ApiBearerAuth()
@Controller('evaluations')
export class EvaluationsController {
  constructor(private readonly evaluationsService: EvaluationsService) {}

  @Get()
  @ApiOperation({ summary: 'List evaluations (paginated, filterable)' })
  async list(@CurrentUser() user: JwtPayload, @Query() query: ListEvaluationsDto) {
    return this.evaluationsService.listEvaluations(user.tenantId, query);
  }

  @Get('queue/qa')
  @Roles(UserRole.QA, UserRole.ADMIN)
  @ApiOperation({ summary: 'QA work queue' })
  async qaQueue(
    @CurrentUser() user: JwtPayload,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.evaluationsService.getQaQueue(
      user.tenantId,
      Number(page ?? 1),
      Number(limit ?? 20),
      search,
    );
  }

  @Get('queue/verifier')
  @Roles(UserRole.VERIFIER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Verifier work queue' })
  async verifierQueue(
    @CurrentUser() user: JwtPayload,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.evaluationsService.getVerifierQueue(
      user.tenantId,
      Number(page ?? 1),
      Number(limit ?? 20),
      search,
    );
  }

  @Get('queue/escalation')
  @Roles(UserRole.VERIFIER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Escalation queue — high-priority items requiring verifier attention' })
  async escalationQueue(
    @CurrentUser() user: JwtPayload,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.evaluationsService.getEscalationQueue(
      user.tenantId,
      Number(page ?? 1),
      Number(limit ?? 20),
      search,
    );
  }

  @Get('queue/audit')
  @Roles(UserRole.ADMIN, UserRole.VERIFIER)
  @ApiOperation({ summary: 'Audit case queue — high deviation verifier cases' })
  async auditQueue(
    @CurrentUser() user: JwtPayload,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.evaluationsService.getAuditQueue(
      user.tenantId,
      Number(page ?? 1),
      Number(limit ?? 20),
      search,
    );
  }

  @Post('preview-score')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dry-run scoring for a form + sample answers' })
  async previewScore(@CurrentUser() user: JwtPayload, @Body() dto: PreviewScoreDto) {
    return this.evaluationsService.previewScore(user.tenantId, dto.formId, dto.answers);
  }

  @Get('audit/export')
  @Roles(UserRole.ADMIN, UserRole.VERIFIER)
  @ApiOperation({ summary: 'Export audit logs as CSV (tenant-scoped)' })
  async exportAuditCsv(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('evaluationId') evaluationId: string | undefined,
    @Res() res: Response,
  ) {
    const csv = await this.evaluationsService.exportAuditLogCsv(
      user.tenantId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
      evaluationId,
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `audit-log-${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(csv);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single evaluation with full layered data' })
  async getOne(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Req() req: Request) {
    const result = await this.evaluationsService.getEvaluation(user.tenantId, id, user.role);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Get(':id/audit')
  @Roles(UserRole.ADMIN, UserRole.VERIFIER)
  @ApiOperation({ summary: 'Get audit log for evaluation' })
  async getAudit(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.evaluationsService.getAuditLog(user.tenantId, id);
  }

  @Post(':id/qa-start')
  @Roles(UserRole.QA, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Claim evaluation for QA review' })
  async qaStart(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.evaluationsService.qaStart(user.tenantId, id, user.sub, user.role);
  }

  @Post(':id/qa-submit')
  @Roles(UserRole.QA, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit QA adjustments' })
  async qaSubmit(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: QaSubmitDto,
  ) {
    return this.evaluationsService.qaSubmit(user.tenantId, id, user.sub, user.role, dto);
  }

  @Post(':id/verifier-start')
  @Roles(UserRole.VERIFIER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Claim evaluation for verifier review' })
  async verifierStart(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.evaluationsService.verifierStart(user.tenantId, id, user.sub, user.role);
  }

  @Post(':id/verifier-approve')
  @Roles(UserRole.VERIFIER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve QA result and lock evaluation' })
  async verifierApprove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.evaluationsService.verifierApprove(user.tenantId, id, user.sub, user.role);
  }

  @Post(':id/verifier-modify')
  @Roles(UserRole.VERIFIER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Modify answers + approve (locks evaluation)' })
  async verifierModify(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: VerifierModifyDto,
  ) {
    return this.evaluationsService.verifierModify(user.tenantId, id, user.sub, user.role, dto);
  }

  @Post(':id/verifier-reject')
  @Roles(UserRole.VERIFIER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject back to QA with reason' })
  async verifierReject(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: VerifierRejectDto,
  ) {
    return this.evaluationsService.verifierReject(user.tenantId, id, user.sub, user.role, dto);
  }

  @Post(':id/retry-ai')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry AI processing for AI_FAILED evaluation' })
  async retryAi(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.evaluationsService.retryAiFailed(user.tenantId, id, user.sub, user.role);
  }

  @Patch('audit-cases/:id/resolve')
  @Roles(UserRole.ADMIN, UserRole.VERIFIER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve or dismiss an audit case' })
  async resolveAuditCase(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { dismiss?: boolean; note?: string },
  ) {
    return this.evaluationsService.resolveAuditCase(
      user.tenantId,
      id,
      user.sub,
      user.role,
      body.dismiss ?? false,
      body.note,
    );
  }

  // ─── Assignment Endpoints ───────────────────────────────────────────────────

  @Post('assign')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually assign an evaluation to a user (admin only)' })
  async manualAssign(@CurrentUser() user: JwtPayload, @Body() dto: ManualAssignDto) {
    return this.evaluationsService.manualAssign(
      user.tenantId,
      dto.evaluationId,
      dto.userId,
      user.sub,
      user.role,
    );
  }

  @Post('assign/round-robin')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Auto-assign unassigned queue items via round-robin (admin only)' })
  async roundRobinAssign(@CurrentUser() user: JwtPayload, @Body() dto: BulkRoundRobinDto) {
    return this.evaluationsService.roundRobinAssign(
      user.tenantId,
      dto.queueType,
      user.sub,
      user.role,
      dto.limit,
    );
  }

  @Post('reassign')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reassign an in-progress evaluation to another user (admin only)' })
  async reassign(@CurrentUser() user: JwtPayload, @Body() dto: ReassignDto) {
    return this.evaluationsService.reassign(
      user.tenantId,
      dto.evaluationId,
      dto.newUserId,
      user.sub,
      user.role,
      dto.reason,
    );
  }
}
