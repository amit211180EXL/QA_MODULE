import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { TenantConnectionPool } from '../tenant/tenant-connection-pool.service';
import { ScoringService } from './scoring.service';
import {
  ListEvaluationsDto,
  QaSubmitDto,
  VerifierModifyDto,
  VerifierRejectDto,
} from './dto/evaluations.dto';
import {
  WorkflowState,
  DeviationType,
  FormQuestion,
  FormSection,
  ScoringStrategy,
  AnswerRecord,
} from '@qa/shared';

@Injectable()
export class EvaluationsService {
  constructor(
    @Inject(TenantConnectionPool) private readonly pool: TenantConnectionPool,
    private readonly scoringService: ScoringService,
  ) {}

  private async getDb(tenantId: string) {
    return this.pool.getClient(tenantId);
  }

  // ─── List ──────────────────────────────────────────────────────────────────

  async listEvaluations(tenantId: string, query: ListEvaluationsDto) {
    const db = await this.getDb(tenantId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.workflowState) where.workflowState = query.workflowState;

    const [items, total] = await db.$transaction([
      db.evaluation.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          conversation: {
            select: { channel: true, agentName: true, customerRef: true, receivedAt: true, externalId: true },
          },
          workflowQueue: { select: { priority: true, dueBy: true, queueType: true } },
        },
      }),
      db.evaluation.count({ where }),
    ]);

    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  // ─── QA Queue ──────────────────────────────────────────────────────────────

  async getQaQueue(tenantId: string, page = 1, limit = 20) {
    const db = await this.getDb(tenantId);
    const skip = (page - 1) * limit;

    const [items, total] = await db.$transaction([
      db.workflowQueue.findMany({
        where: { queueType: 'QA_QUEUE' },
        skip,
        take: limit,
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        include: {
          evaluation: {
            select: {
              id: true,
              workflowState: true,
              aiScore: true,
              formDefinitionId: true,
              formVersion: true,
              conversation: {
                select: { id: true, channel: true, agentName: true, customerRef: true, receivedAt: true, externalId: true },
              },
            },
          },
        },
      }),
      db.workflowQueue.count({ where: { queueType: 'QA_QUEUE' } }),
    ]);

    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  // ─── Verifier Queue ────────────────────────────────────────────────────────

  async getVerifierQueue(tenantId: string, page = 1, limit = 20) {
    const db = await this.getDb(tenantId);
    const skip = (page - 1) * limit;

    const [items, total] = await db.$transaction([
      db.workflowQueue.findMany({
        where: { queueType: 'VERIFIER_QUEUE' },
        skip,
        take: limit,
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        include: {
          evaluation: {
            select: {
              id: true,
              workflowState: true,
              aiScore: true,
              qaScore: true,
              formDefinitionId: true,
              formVersion: true,
              conversation: {
                select: { id: true, channel: true, agentName: true, customerRef: true, receivedAt: true, externalId: true },
              },
            },
          },
        },
      }),
      db.workflowQueue.count({ where: { queueType: 'VERIFIER_QUEUE' } }),
    ]);

    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  // ─── Get single ────────────────────────────────────────────────────────────

  async getEvaluation(tenantId: string, id: string) {
    const db = await this.getDb(tenantId);
    const evaluation = await db.evaluation.findUnique({
      where: { id },
      include: {
        conversation: true,
        formDefinition: true,
        deviationRecords: true,
        auditLogs: { orderBy: { createdAt: 'desc' }, take: 50 },
        workflowQueue: true,
      },
    });
    if (!evaluation) throw new NotFoundException({ code: 'EVALUATION_NOT_FOUND', message: 'Evaluation not found' });
    return evaluation;
  }

  // ─── QA Start (claim) ──────────────────────────────────────────────────────

  async qaStart(tenantId: string, id: string, userId: string, actorRole: string) {
    const db = await this.getDb(tenantId);
    const ev = await db.evaluation.findUnique({ where: { id } });
    if (!ev) throw new NotFoundException({ code: 'EVALUATION_NOT_FOUND', message: 'Evaluation not found' });

    if (ev.workflowState !== WorkflowState.QA_PENDING) {
      throw new ConflictException({
        code: 'INVALID_STATE',
        message: `Cannot claim evaluation in ${ev.workflowState} state`,
      });
    }

    const now = new Date();
    await db.$transaction([
      db.evaluation.update({
        where: { id },
        data: {
          workflowState: WorkflowState.QA_IN_PROGRESS,
          qaUserId: userId,
          qaStartedAt: now,
        },
      }),
      db.workflowQueue.updateMany({
        where: { evaluationId: id },
        data: { assignedTo: userId },
      }),
      db.auditLog.create({
        data: {
          evaluationId: id,
          entityType: 'evaluation',
          entityId: id,
          action: 'qa_start',
          actorId: userId,
          actorRole,
          metadata: { workflowState: { from: 'QA_PENDING', to: 'QA_IN_PROGRESS' } } as never,
        },
      }),
    ]);

    return { workflowState: WorkflowState.QA_IN_PROGRESS };
  }

  // ─── QA Submit ─────────────────────────────────────────────────────────────

  async qaSubmit(tenantId: string, id: string, userId: string, actorRole: string, dto: QaSubmitDto) {
    const db = await this.getDb(tenantId);
    const ev = await db.evaluation.findUnique({
      where: { id },
      include: { formDefinition: true },
    });
    if (!ev) throw new NotFoundException({ code: 'EVALUATION_NOT_FOUND', message: 'Evaluation not found' });

    if (ev.workflowState !== WorkflowState.QA_IN_PROGRESS) {
      throw new ConflictException({ code: 'ALREADY_SUBMITTED', message: 'Evaluation is not in QA_IN_PROGRESS state' });
    }
    if (ev.qaUserId !== userId) {
      throw new ForbiddenException({ code: 'NOT_CLAIMED_BY_YOU', message: 'This evaluation was not claimed by you' });
    }

    // Build adjusted answers on top of AI answers
    const aiLayer = ev.aiResponseData as EvaluationResponseLayer | null;
    const aiAnswers: Record<string, AnswerRecord> = aiLayer?.answers ?? {};
    const adjustedAnswers: Record<string, AnswerRecord> = { ...aiAnswers };

    for (const [key, adj] of Object.entries(dto.adjustedAnswers)) {
      const existing = aiAnswers[key];
      if (existing && adj.value !== existing.value && !adj.overrideReason) {
        throw new BadRequestException({
          code: 'MISSING_OVERRIDE_REASON',
          message: `Question "${key}" value changed without overrideReason`,
        });
      }
      adjustedAnswers[key] = {
        value: adj.value,
        overrideReason: adj.overrideReason,
      };
    }

    // Score the QA layer
    const form = ev.formDefinition;
    const scoreResult = this.scoringService.score(
      adjustedAnswers,
      form.questions as unknown as FormQuestion[],
      form.sections as unknown as FormSection[],
      form.scoringStrategy as unknown as ScoringStrategy,
    );

    const now = new Date();


    // Compute deviation from AI score
    const deviations = [];
    if (ev.aiScore !== null) {
      const deviation = Math.abs(scoreResult.overallScore - ev.aiScore);
      deviations.push({
        type: DeviationType.AI_VS_QA as never,
        evaluationId: id,
        scoreA: ev.aiScore,
        scoreB: scoreResult.overallScore,
        deviation,
      });
    }

    const qaLayer = {
      answers: scoreResult.answers,
      sectionScores: scoreResult.sectionScores,
      overallScore: scoreResult.overallScore,
      passFail: scoreResult.passFail,
    };

    await db.$transaction([
      db.evaluation.update({
        where: { id },
        data: {
          workflowState: WorkflowState.QA_COMPLETED,
          qaAdjustedData: qaLayer as never,
          qaScore: scoreResult.overallScore,
          qaCompletedAt: now,
          feedback: dto.feedback,
          flags: (dto.flags ?? []) as never,
        },
      }),
      // Create deviation records
      ...deviations.map((d) => db.deviationRecord.create({ data: d })),
      // Move to verifier queue
      db.workflowQueue.upsert({
        where: { evaluationId: id },
        create: { evaluationId: id, queueType: 'VERIFIER_QUEUE', priority: 5 },
        update: { queueType: 'VERIFIER_QUEUE', assignedTo: null },
      }),
      db.auditLog.create({
        data: {
          evaluationId: id,
          entityType: 'evaluation',
          entityId: id,
          action: 'qa_submit',
          actorId: userId,
          actorRole,
          metadata: {
            workflowState: { from: 'QA_IN_PROGRESS', to: 'QA_COMPLETED' },
            qaScore: scoreResult.overallScore,
          } as never,
        },
      }),
    ]);

    return {
      workflowState: WorkflowState.QA_COMPLETED,
      qaScore: scoreResult.overallScore,
      passFail: scoreResult.passFail,
      deviations,
    };
  }

  // ─── Verifier Start (claim) ────────────────────────────────────────────────

  async verifierStart(tenantId: string, id: string, userId: string, actorRole: string) {
    const db = await this.getDb(tenantId);
    const ev = await db.evaluation.findUnique({ where: { id } });
    if (!ev) throw new NotFoundException({ code: 'EVALUATION_NOT_FOUND', message: 'Evaluation not found' });

    if (ev.workflowState !== WorkflowState.VERIFIER_PENDING && ev.workflowState !== WorkflowState.QA_COMPLETED) {
      throw new ConflictException({
        code: 'INVALID_STATE',
        message: `Cannot claim evaluation in ${ev.workflowState} state`,
      });
    }

    const now = new Date();
    await db.$transaction([
      db.evaluation.update({
        where: { id },
        data: {
          workflowState: WorkflowState.VERIFIER_IN_PROGRESS,
          verifierUserId: userId,
          verifierStartedAt: now,
        },
      }),
      db.workflowQueue.updateMany({
        where: { evaluationId: id },
        data: { assignedTo: userId },
      }),
      db.auditLog.create({
        data: {
          evaluationId: id,
          entityType: 'evaluation',
          entityId: id,
          action: 'verifier_start',
          actorId: userId,
          actorRole,
          metadata: { workflowState: { from: ev.workflowState, to: 'VERIFIER_IN_PROGRESS' } } as never,
        },
      }),
    ]);

    return { workflowState: WorkflowState.VERIFIER_IN_PROGRESS };
  }

  // ─── Verifier Approve ──────────────────────────────────────────────────────

  async verifierApprove(tenantId: string, id: string, userId: string, actorRole: string) {
    const db = await this.getDb(tenantId);
    const ev = await db.evaluation.findUnique({ where: { id } });
    if (!ev) throw new NotFoundException({ code: 'EVALUATION_NOT_FOUND', message: 'Evaluation not found' });

    if (ev.workflowState !== WorkflowState.VERIFIER_IN_PROGRESS) {
      throw new ConflictException({ code: 'INVALID_STATE', message: 'Evaluation is not in VERIFIER_IN_PROGRESS state' });
    }
    if (ev.verifierUserId !== userId) {
      throw new ForbiddenException({ code: 'NOT_CLAIMED_BY_YOU', message: 'Not claimed by you' });
    }

    const qaLayer = ev.qaAdjustedData as EvaluationResponseLayer | null;
    const finalScore = ev.qaScore;
    const passFail = qaLayer?.passFail ?? false;
    const now = new Date();

    await db.$transaction([
      db.evaluation.update({
        where: { id },
        data: {
          workflowState: WorkflowState.LOCKED,
          verifierFinalData: ev.qaAdjustedData as never,
          finalResponseData: ev.qaAdjustedData as never,
          verifierScore: finalScore,
          finalScore,
          passFail,
          verifierCompletedAt: now,
          lockedAt: now,
        },
      }),
      db.workflowQueue.deleteMany({ where: { evaluationId: id } }),
      db.conversation.update({
        where: { id: ev.conversationId },
        data: { status: 'COMPLETED' },
      }),
      db.auditLog.create({
        data: {
          evaluationId: id,
          entityType: 'evaluation',
          entityId: id,
          action: 'verifier_approve',
          actorId: userId,
          actorRole,
          metadata: { workflowState: { from: 'VERIFIER_IN_PROGRESS', to: 'LOCKED' }, finalScore } as never,
        },
      }),
    ]);

    return { workflowState: WorkflowState.LOCKED, finalScore, passFail };
  }

  // ─── Verifier Modify + Approve ────────────────────────────────────────────

  async verifierModify(tenantId: string, id: string, userId: string, actorRole: string, dto: VerifierModifyDto) {
    const db = await this.getDb(tenantId);
    const ev = await db.evaluation.findUnique({ where: { id }, include: { formDefinition: true } });
    if (!ev) throw new NotFoundException({ code: 'EVALUATION_NOT_FOUND', message: 'Evaluation not found' });

    if (ev.workflowState !== WorkflowState.VERIFIER_IN_PROGRESS) {
      throw new ConflictException({ code: 'INVALID_STATE', message: 'Evaluation is not in VERIFIER_IN_PROGRESS' });
    }
    if (ev.verifierUserId !== userId) {
      throw new ForbiddenException({ code: 'NOT_CLAIMED_BY_YOU', message: 'Not claimed by you' });
    }

    const qaLayer = ev.qaAdjustedData as EvaluationResponseLayer | null;
    const mergedAnswers: Record<string, AnswerRecord> = { ...(qaLayer?.answers ?? {}) };
    for (const [key, mod] of Object.entries(dto.modifiedAnswers)) {
      if (!mod.overrideReason) {
        throw new BadRequestException({ code: 'MISSING_OVERRIDE_REASON', message: `overrideReason required for "${key}"` });
      }
      mergedAnswers[key] = { value: mod.value, overrideReason: mod.overrideReason };
    }

    const scoreResult = this.scoringService.score(
      mergedAnswers,
      ev.formDefinition.questions as unknown as FormQuestion[],
      ev.formDefinition.sections as unknown as FormSection[],
      ev.formDefinition.scoringStrategy as unknown as ScoringStrategy,
    );

    const now = new Date();
    const verifierLayer = { answers: mergedAnswers, sectionScores: scoreResult.sectionScores, overallScore: scoreResult.overallScore, passFail: scoreResult.passFail };

    // Compute QA→Verifier deviation
    const deviations = [];
    if (ev.qaScore !== null) {
      deviations.push({
        type: DeviationType.QA_VS_VERIFIER as never,
        evaluationId: id,
        scoreA: ev.qaScore,
        scoreB: scoreResult.overallScore,
        deviation: Math.abs(scoreResult.overallScore - ev.qaScore),
      });
    }

    await db.$transaction([
      db.evaluation.update({
        where: { id },
        data: {
          workflowState: WorkflowState.LOCKED,
          verifierFinalData: verifierLayer as never,
          finalResponseData: verifierLayer as never,
          verifierScore: scoreResult.overallScore,
          finalScore: scoreResult.overallScore,
          passFail: scoreResult.passFail,
          verifierCompletedAt: now,
          lockedAt: now,
          feedback: dto.feedback,
        },
      }),
      ...deviations.map((d) => db.deviationRecord.create({ data: d })),
      db.workflowQueue.deleteMany({ where: { evaluationId: id } }),
      db.conversation.update({
        where: { id: ev.conversationId },
        data: { status: 'COMPLETED' },
      }),
      db.auditLog.create({
        data: {
          evaluationId: id,
          entityType: 'evaluation',
          entityId: id,
          action: 'verifier_modify',
          actorId: userId,
          actorRole,
          metadata: { finalScore: scoreResult.overallScore } as never,
        },
      }),
    ]);

    return { workflowState: WorkflowState.LOCKED, finalScore: scoreResult.overallScore, passFail: scoreResult.passFail };
  }

  // ─── Verifier Reject ──────────────────────────────────────────────────────

  async verifierReject(tenantId: string, id: string, userId: string, actorRole: string, dto: VerifierRejectDto) {
    const db = await this.getDb(tenantId);
    const ev = await db.evaluation.findUnique({ where: { id } });
    if (!ev) throw new NotFoundException({ code: 'EVALUATION_NOT_FOUND', message: 'Evaluation not found' });

    if (ev.workflowState !== WorkflowState.VERIFIER_IN_PROGRESS) {
      throw new ConflictException({ code: 'INVALID_STATE', message: 'Evaluation is not in VERIFIER_IN_PROGRESS' });
    }

    const now = new Date();
    await db.$transaction([
      db.evaluation.update({
        where: { id },
        data: {
          workflowState: WorkflowState.QA_PENDING,
          verifierRejectedAt: now,
          verifierRejectReason: dto.reason,
          verifierUserId: null,
          verifierStartedAt: null,
        },
      }),
      db.workflowQueue.updateMany({
        where: { evaluationId: id },
        data: { queueType: 'QA_QUEUE', assignedTo: null },
      }),
      db.auditLog.create({
        data: {
          evaluationId: id,
          entityType: 'evaluation',
          entityId: id,
          action: 'verifier_reject',
          actorId: userId,
          actorRole,
          metadata: { reason: dto.reason, workflowState: { from: 'VERIFIER_IN_PROGRESS', to: 'QA_PENDING' } } as never,
        },
      }),
    ]);

    return { workflowState: WorkflowState.QA_PENDING };
  }

  // ─── Preview Score ─────────────────────────────────────────────────────────

  async previewScore(tenantId: string, formId: string, rawAnswers: Record<string, unknown>) {
    const db = await this.getDb(tenantId);
    const form = await db.formDefinition.findUnique({ where: { id: formId } });
    if (!form) throw new NotFoundException({ code: 'FORM_NOT_FOUND', message: 'Form not found' });

    const answers: Record<string, AnswerRecord> = {};
    for (const [key, value] of Object.entries(rawAnswers)) {
      answers[key] = { value };
    }

    return this.scoringService.score(
      answers,
      form.questions as unknown as FormQuestion[],
      form.sections as unknown as FormSection[],
      form.scoringStrategy as unknown as ScoringStrategy,
    );
  }

  // ─── Audit log ────────────────────────────────────────────────────────────

  async getAuditLog(tenantId: string, evaluationId: string) {
    const db = await this.getDb(tenantId);
    const logs = await db.auditLog.findMany({
      where: { evaluationId },
      orderBy: { createdAt: 'desc' },
    });
    return logs;
  }
}

// Re-export the shape for use in the worker
type EvaluationResponseLayer = import('@qa/shared').EvaluationResponseLayer;
