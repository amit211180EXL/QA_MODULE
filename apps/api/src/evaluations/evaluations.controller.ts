import { Controller, Get, Post, Param, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { EvaluationsService } from './evaluations.service';
import {
  ListEvaluationsDto,
  QaSubmitDto,
  VerifierModifyDto,
  VerifierRejectDto,
  PreviewScoreDto,
} from './dto/evaluations.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload, UserRole } from '@qa/shared';

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
  ) {
    return this.evaluationsService.getQaQueue(
      user.tenantId,
      Number(page ?? 1),
      Number(limit ?? 20),
    );
  }

  @Get('queue/verifier')
  @Roles(UserRole.VERIFIER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Verifier work queue' })
  async verifierQueue(
    @CurrentUser() user: JwtPayload,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.evaluationsService.getVerifierQueue(
      user.tenantId,
      Number(page ?? 1),
      Number(limit ?? 20),
    );
  }

  @Post('preview-score')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dry-run scoring for a form + sample answers' })
  async previewScore(@CurrentUser() user: JwtPayload, @Body() dto: PreviewScoreDto) {
    return this.evaluationsService.previewScore(user.tenantId, dto.formId, dto.answers);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single evaluation with full layered data' })
  async getOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.evaluationsService.getEvaluation(user.tenantId, id);
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
}
