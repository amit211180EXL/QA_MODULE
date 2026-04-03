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
  EvalProcessJobPayload,
  QUEUE_NAMES,
} from '@qa/shared';
import { getMasterClient } from '@qa/prisma-master';
import { OutboundWebhooksService } from '../webhooks/outbound-webhooks.service';
import { Queue } from 'bullmq';
import { getEnv } from '@qa/config';
import { createHash } from 'crypto';

@Injectable()
export class EvaluationsService {
  private readonly evalQueue: Queue<EvalProcessJobPayload> | null = null;

  constructor(
    @Inject(TenantConnectionPool) private readonly pool: TenantConnectionPool,
    private readonly scoringService: ScoringService,
    private readonly outboundWebhooks: OutboundWebhooksService,
  ) {
    const env = getEnv();
    if (env.REDIS_ENABLED !== 'false') {
      this.evalQueue = new Queue(QUEUE_NAMES.EVAL_PROCESS, {
        connection: {
          host: env.REDIS_HOST,
          port: env.REDIS_PORT,
          password: env.REDIS_PASSWORD,
          maxRetriesPerRequest: 1,
          connectTimeout: 3000,
          lazyConnect: true,
        },
      });
    }
  }

  private async getDb(tenantId: string) {
    return this.pool.getClient(tenantId);
  }

  private deterministicAlias(tenantId: string, kind: 'agent' | 'qa', source: string): string {
    const env = getEnv();
    const salt = env.MASTER_ENCRYPTION_KEY || env.JWT_SECRET || 'qa-platform';
    const digest = createHash('sha256')
      .update(`${salt}:${tenantId}:${kind}:${source}`)
      .digest('hex')
      .slice(0, 12);
    return kind === 'agent' ? `agent_${digest}` : `qa_${digest}`;
  }

  private derivePassFail(
    score: number | null | undefined,
    passMark: number,
    fallback: boolean | null | undefined,
  ): boolean | null {
    if (typeof score === 'number') return score >= passMark;
    return fallback ?? null;
  }

  private normalizeResponseLayerPassFail(
    layer: unknown,
    score: number | null | undefined,
    passMark: number,
  ) {
    if (!layer || typeof layer !== 'object') return;

    const record = layer as Record<string, unknown>;
    const layerScore = typeof record.overallScore === 'number' ? record.overallScore : null;
    const fallback = typeof record.passFail === 'boolean' ? record.passFail : null;
    record.passFail = this.derivePassFail(score ?? layerScore, passMark, fallback);
  }

  private normalizeEvaluationPassFail(evaluation: Record<string, unknown>) {
    const formDefinition =
      evaluation.formDefinition && typeof evaluation.formDefinition === 'object'
        ? (evaluation.formDefinition as Record<string, unknown>)
        : null;
    const scoringStrategy =
      formDefinition?.scoringStrategy && typeof formDefinition.scoringStrategy === 'object'
        ? (formDefinition.scoringStrategy as Record<string, unknown>)
        : null;
    const passMark = typeof scoringStrategy?.passMark === 'number' ? scoringStrategy.passMark : 70;

    const aiScore = typeof evaluation.aiScore === 'number' ? evaluation.aiScore : null;
    const qaScore = typeof evaluation.qaScore === 'number' ? evaluation.qaScore : null;
    const verifierScore = typeof evaluation.verifierScore === 'number' ? evaluation.verifierScore : null;
    const finalScore = typeof evaluation.finalScore === 'number' ? evaluation.finalScore : null;
    const passFail = typeof evaluation.passFail === 'boolean' ? evaluation.passFail : null;

    this.normalizeResponseLayerPassFail(evaluation.aiResponseData, aiScore, passMark);
    this.normalizeResponseLayerPassFail(evaluation.qaAdjustedData, qaScore, passMark);
    this.normalizeResponseLayerPassFail(evaluation.verifierFinalData, verifierScore ?? finalScore, passMark);
    this.normalizeResponseLayerPassFail(evaluation.finalResponseData, finalScore, passMark);

    evaluation.passFail = this.derivePassFail(finalScore, passMark, passFail);
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
            select: {
              channel: true,
              agentName: true,
              customerRef: true,
              receivedAt: true,
              externalId: true,
            },
          },
          workflowQueue: { select: { priority: true, dueBy: true, queueType: true } },
        },
      }),
      db.evaluation.count({ where }),
    ]);

    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  // ─── QA Queue ──────────────────────────────────────────────────────────────

  async getQaQueue(tenantId: string, page = 1, limit = 20, search?: string) {
    const db = await this.getDb(tenantId);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { queueType: 'QA_QUEUE' };
    if (search?.trim()) {
      const s = search.trim();
      where.evaluation = {
        conversation: {
          OR: [
            { externalId: { contains: s, mode: 'insensitive' } },
            { channel: { contains: s, mode: 'insensitive' } },
            { agentName: { contains: s, mode: 'insensitive' } },
            { customerRef: { contains: s, mode: 'insensitive' } },
          ],
        },
      };
    }

    const [items, total] = await db.$transaction([
      db.workflowQueue.findMany({
        where,
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
              verifierRejectReason: true,
              verifierRejectedAt: true,
              formDefinitionId: true,
              formVersion: true,
              conversation: {
                select: {
                  id: true,
                  channel: true,
                  agentName: true,
                  customerRef: true,
                  receivedAt: true,
                  externalId: true,
                },
              },
            },
          },
        },
      }),
      db.workflowQueue.count({ where }),
    ]);

    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  // ─── Verifier Queue ────────────────────────────────────────────────────────

  async getVerifierQueue(tenantId: string, page = 1, limit = 20, search?: string) {
    const db = await this.getDb(tenantId);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { queueType: 'VERIFIER_QUEUE' };
    if (search?.trim()) {
      const s = search.trim();
      where.evaluation = {
        conversation: {
          OR: [
            { externalId: { contains: s, mode: 'insensitive' } },
            { channel: { contains: s, mode: 'insensitive' } },
            { agentName: { contains: s, mode: 'insensitive' } },
            { customerRef: { contains: s, mode: 'insensitive' } },
          ],
        },
      };
    }

    const [items, total] = await db.$transaction([
      db.workflowQueue.findMany({
        where,
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
                select: {
                  id: true,
                  channel: true,
                  agentName: true,
                  customerRef: true,
                  receivedAt: true,
                  externalId: true,
                },
              },
            },
          },
        },
      }),
      db.workflowQueue.count({ where }),
    ]);

    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  // ─── Get single ────────────────────────────────────────────────────────────

  async getEvaluation(tenantId: string, id: string, actorRole: string) {
    const db = await this.getDb(tenantId);
    const masterDb = getMasterClient();

    const [evaluation, blindReview] = await Promise.all([
      db.evaluation.findUnique({
        where: { id },
        include: {
          conversation: true,
          formDefinition: true,
          deviationRecords: true,
          auditLogs: { orderBy: { createdAt: 'desc' }, take: 50 },
          workflowQueue: true,
        },
      }),
      masterDb.blindReviewSettings.findUnique({ where: { tenantId } }),
    ]);

    if (!evaluation)
      throw new NotFoundException({
        code: 'EVALUATION_NOT_FOUND',
        message: 'Evaluation not found',
      });

    // ── Blind review anonymization ──────────────────────────────────────────
    // QA reviewers must not see agent identity when hideAgentFromQA is enabled.
    if (blindReview?.hideAgentFromQA && actorRole === 'QA') {
      const source =
        evaluation.conversation.agentId ?? evaluation.conversation.agentName ?? evaluation.conversation.id;
      const alias = this.deterministicAlias(tenantId, 'agent', String(source));
      (evaluation.conversation as Record<string, unknown>).agentId = alias;
      (evaluation.conversation as Record<string, unknown>).agentName = alias;
    }
    // Verifiers must not see who did the QA review when hideQAFromVerifier is enabled.
    if (blindReview?.hideQAFromVerifier && actorRole === 'VERIFIER') {
      const qaSource = evaluation.qaUserId ?? evaluation.id;
      (evaluation as Record<string, unknown>).qaUserId = this.deterministicAlias(
        tenantId,
        'qa',
        String(qaSource),
      );
    }

    this.normalizeEvaluationPassFail(evaluation as Record<string, unknown>);

    return evaluation;
  }

  // ─── QA Start (claim) ──────────────────────────────────────────────────────

  async qaStart(tenantId: string, id: string, userId: string, actorRole: string) {
    const db = await this.getDb(tenantId);
    const ev = await db.evaluation.findUnique({ where: { id } });
    if (!ev)
      throw new NotFoundException({
        code: 'EVALUATION_NOT_FOUND',
        message: 'Evaluation not found',
      });

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

  async qaSubmit(
    tenantId: string,
    id: string,
    userId: string,
    actorRole: string,
    dto: QaSubmitDto,
  ) {
    const db = await this.getDb(tenantId);
    const ev = await db.evaluation.findUnique({
      where: { id },
      include: { formDefinition: true },
    });
    if (!ev)
      throw new NotFoundException({
        code: 'EVALUATION_NOT_FOUND',
        message: 'Evaluation not found',
      });

    if (ev.workflowState !== WorkflowState.QA_IN_PROGRESS) {
      throw new ConflictException({
        code: 'ALREADY_SUBMITTED',
        message: 'Evaluation is not in QA_IN_PROGRESS state',
      });
    }
    if (ev.qaUserId !== userId) {
      throw new ForbiddenException({
        code: 'NOT_CLAIMED_BY_YOU',
        message: 'This evaluation was not claimed by you',
      });
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

    // Build per-question override list (keys where QA changed the AI answer)
    const overriddenKeys = Object.keys(dto.adjustedAnswers).filter((key) => {
      const aiVal = aiAnswers[key]?.value;
      const qaVal = dto.adjustedAnswers[key]?.value;
      return aiVal !== undefined && String(qaVal) !== String(aiVal);
    });

    // Map questionKey → sectionId for denormalization
    const questionSectionMap: Record<string, string> = {};
    for (const q of form.questions as unknown as FormQuestion[]) {
      questionSectionMap[q.key] = q.sectionId;
    }

    // Compute deviation from AI score
    const deviations: any[] = [];
    let aiQaDeviation = 0;
    if (ev.aiScore !== null) {
      aiQaDeviation = Math.abs(scoreResult.overallScore - ev.aiScore);
      deviations.push({
        type: DeviationType.AI_VS_QA as never,
        evaluationId: id,
        scoreA: ev.aiScore,
        scoreB: scoreResult.overallScore,
        deviation: aiQaDeviation,
      });
    }

    // Per-question deviation records (override indicator, deviation = 1 = overridden)
    for (const key of overriddenKeys) {
      const aiQScore = scoreResult.answers[key]
        ? (adjustedAnswers[key]?.value as number) ?? 0
        : 0;
      const aiAScore = aiAnswers[key]?.value as number ?? 0;
      deviations.push({
        type: DeviationType.AI_VS_QA as never,
        evaluationId: id,
        questionKey: key,
        sectionId: questionSectionMap[key] ?? null,
        scoreA: typeof aiAScore === 'number' ? aiAScore : 0,
        scoreB: typeof aiQScore === 'number' ? aiQScore : 0,
        deviation: 1, // presence = 1 override event; used for override-count analytics
      } as never);
    }

    // Check escalation rules from master DB
    const masterDb = getMasterClient();
    const escalationRule = await masterDb.escalationRule.findFirst({
      where: { tenantId },
    });
    const escalationThreshold = escalationRule?.qaDeviationThreshold ?? 15;
    const shouldEscalate = aiQaDeviation > escalationThreshold;

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
          ...(shouldEscalate && {
            isEscalated: true,
            escalationReason: `AI↔QA deviation ${aiQaDeviation.toFixed(1)}% exceeds threshold ${escalationThreshold}%`,
          }),
        },
      }),
      // Create deviation records
      ...deviations.map((d) => db.deviationRecord.create({ data: d })),
      // Move to verifier queue (or escalation queue if threshold exceeded)
      db.workflowQueue.upsert({
        where: { evaluationId: id },
        create: {
          evaluationId: id,
          queueType: shouldEscalate ? 'ESCALATION_QUEUE' : 'VERIFIER_QUEUE',
          priority: shouldEscalate ? 1 : 5,
        },
        update: {
          queueType: shouldEscalate ? 'ESCALATION_QUEUE' : 'VERIFIER_QUEUE',
          priority: shouldEscalate ? 1 : 5,
          assignedTo: null,
        },
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
            aiQaDeviation,
            escalated: shouldEscalate,
          } as never,
        },
      }),
    ]);

    if (shouldEscalate) {
      this.outboundWebhooks.deliver(tenantId, 'evaluation.escalated', {
        evaluationId: id,
        conversationId: ev.conversationId,
        workflowState: 'ESCALATION_QUEUE',
        finalScore: null,
        passFail: null,
      });
    }

    return {
      workflowState: WorkflowState.QA_COMPLETED,
      qaScore: scoreResult.overallScore,
      passFail: scoreResult.passFail,
      deviations,
      escalated: shouldEscalate,
    };
  }

  // ─── Verifier Start (claim) ────────────────────────────────────────────────

  async verifierStart(tenantId: string, id: string, userId: string, actorRole: string) {
    const db = await this.getDb(tenantId);
    const ev = await db.evaluation.findUnique({ where: { id } });
    if (!ev)
      throw new NotFoundException({
        code: 'EVALUATION_NOT_FOUND',
        message: 'Evaluation not found',
      });

    if (
      ev.workflowState !== WorkflowState.VERIFIER_PENDING &&
      ev.workflowState !== WorkflowState.QA_COMPLETED
    ) {
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
          metadata: {
            workflowState: { from: ev.workflowState, to: 'VERIFIER_IN_PROGRESS' },
          } as never,
        },
      }),
    ]);

    return { workflowState: WorkflowState.VERIFIER_IN_PROGRESS };
  }

  // ─── Verifier Approve ──────────────────────────────────────────────────────

  async verifierApprove(tenantId: string, id: string, userId: string, actorRole: string) {
    const db = await this.getDb(tenantId);
    const ev = await db.evaluation.findUnique({
      where: { id },
      include: { formDefinition: { select: { scoringStrategy: true } } },
    });
    if (!ev)
      throw new NotFoundException({
        code: 'EVALUATION_NOT_FOUND',
        message: 'Evaluation not found',
      });

    if (ev.workflowState !== WorkflowState.VERIFIER_IN_PROGRESS) {
      throw new ConflictException({
        code: 'INVALID_STATE',
        message: 'Evaluation is not in VERIFIER_IN_PROGRESS state',
      });
    }
    if (ev.verifierUserId !== userId) {
      throw new ForbiddenException({ code: 'NOT_CLAIMED_BY_YOU', message: 'Not claimed by you' });
    }

    const qaLayer = ev.qaAdjustedData as EvaluationResponseLayer | null;
    const passMark =
      (ev.formDefinition?.scoringStrategy as { passMark?: number } | null)?.passMark ?? 70;
    const finalScore = ev.qaScore ?? qaLayer?.overallScore ?? null;
    const passFail = finalScore !== null ? finalScore >= passMark : false;
    const normalizedQaLayer = qaLayer
      ? {
          ...qaLayer,
          overallScore: finalScore ?? qaLayer.overallScore,
          passFail,
        }
      : null;
    const now = new Date();

    await db.$transaction([
      db.evaluation.update({
        where: { id },
        data: {
          workflowState: WorkflowState.LOCKED,
          verifierFinalData: normalizedQaLayer as never,
          finalResponseData: normalizedQaLayer as never,
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
          metadata: {
            workflowState: { from: 'VERIFIER_IN_PROGRESS', to: 'LOCKED' },
            finalScore,
          } as never,
        },
      }),
    ]);

    this.outboundWebhooks.deliver(tenantId, 'evaluation.completed', {
      evaluationId: id,
      conversationId: ev.conversationId,
      workflowState: WorkflowState.LOCKED,
      finalScore,
      passFail,
    });

    return { workflowState: WorkflowState.LOCKED, finalScore, passFail };
  }

  // ─── Verifier Modify + Approve ────────────────────────────────────────────

  async verifierModify(
    tenantId: string,
    id: string,
    userId: string,
    actorRole: string,
    dto: VerifierModifyDto,
  ) {
    const db = await this.getDb(tenantId);
    const ev = await db.evaluation.findUnique({ where: { id }, include: { formDefinition: true } });
    if (!ev)
      throw new NotFoundException({
        code: 'EVALUATION_NOT_FOUND',
        message: 'Evaluation not found',
      });

    if (ev.workflowState !== WorkflowState.VERIFIER_IN_PROGRESS) {
      throw new ConflictException({
        code: 'INVALID_STATE',
        message: 'Evaluation is not in VERIFIER_IN_PROGRESS',
      });
    }
    if (ev.verifierUserId !== userId) {
      throw new ForbiddenException({ code: 'NOT_CLAIMED_BY_YOU', message: 'Not claimed by you' });
    }

    const qaLayer = ev.qaAdjustedData as EvaluationResponseLayer | null;
    const mergedAnswers: Record<string, AnswerRecord> = { ...(qaLayer?.answers ?? {}) };
    for (const [key, mod] of Object.entries(dto.modifiedAnswers)) {
      if (!mod.overrideReason) {
        throw new BadRequestException({
          code: 'MISSING_OVERRIDE_REASON',
          message: `overrideReason required for "${key}"`,
        });
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
    const verifierLayer = {
      answers: mergedAnswers,
      sectionScores: scoreResult.sectionScores,
      overallScore: scoreResult.overallScore,
      passFail: scoreResult.passFail,
    };

    const masterDb = getMasterClient();
    const escalationRule = await masterDb.escalationRule.findFirst({
      where: { tenantId },
      select: { verifierDeviationThreshold: true },
    });
    const verifierDeviationThreshold = escalationRule?.verifierDeviationThreshold ?? 10;

    // Compute QA→Verifier deviation
    const deviations: any[] = [];
    let qaVerifierDeviation = 0;
    if (ev.qaScore !== null) {
      qaVerifierDeviation = Math.abs(scoreResult.overallScore - ev.qaScore);
      deviations.push({
        type: DeviationType.QA_VS_VERIFIER as never,
        evaluationId: id,
        scoreA: ev.qaScore,
        scoreB: scoreResult.overallScore,
        deviation: qaVerifierDeviation,
      });
    }

    const shouldCreateAuditCase = qaVerifierDeviation >= verifierDeviationThreshold;

    // Per-question verifier override deviation records
    const questionSectionMap: Record<string, string> = {};
    for (const q of ev.formDefinition.questions as unknown as FormQuestion[]) {
      questionSectionMap[q.key] = q.sectionId;
    }
    for (const key of Object.keys(dto.modifiedAnswers)) {
      const qaVal = qaLayer?.answers[key]?.value;
      const vVal = dto.modifiedAnswers[key]?.value;
      if (qaVal === undefined || String(vVal) === String(qaVal)) continue;
      deviations.push({
        type: DeviationType.QA_VS_VERIFIER as never,
        evaluationId: id,
        questionKey: key,
        sectionId: questionSectionMap[key] ?? null,
        scoreA: typeof qaVal === 'number' ? qaVal : 0,
        scoreB: typeof vVal === 'number' ? vVal : 0,
        deviation: 1,
      } as never);
    }

    await db.$transaction(async (tx) => {
      await tx.evaluation.update({
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
      });

      for (const d of deviations) {
        await tx.deviationRecord.create({ data: d });
      }

      if (shouldCreateAuditCase) {
        await tx.auditCase.upsert({
          where: { evaluationId: id },
          create: {
            evaluationId: id,
            deviation: qaVerifierDeviation,
            threshold: verifierDeviationThreshold,
            reason: `Verifier deviation ${qaVerifierDeviation.toFixed(2)} exceeds threshold ${verifierDeviationThreshold.toFixed(2)}`,
            status: 'OPEN',
          },
          update: {
            deviation: qaVerifierDeviation,
            threshold: verifierDeviationThreshold,
            reason: `Verifier deviation ${qaVerifierDeviation.toFixed(2)} exceeds threshold ${verifierDeviationThreshold.toFixed(2)}`,
            status: 'OPEN',
            resolvedAt: null,
            resolvedBy: null,
            resolutionNote: null,
          },
        });

        await tx.workflowQueue.upsert({
          where: { evaluationId: id },
          create: { evaluationId: id, queueType: 'AUDIT_QUEUE', priority: 1 },
          update: { queueType: 'AUDIT_QUEUE', priority: 1, assignedTo: null },
        });
      } else {
        await tx.workflowQueue.deleteMany({ where: { evaluationId: id } });
      }

      await tx.conversation.update({
        where: { id: ev.conversationId },
        data: { status: 'COMPLETED' },
      });

      await tx.auditLog.create({
        data: {
          evaluationId: id,
          entityType: 'evaluation',
          entityId: id,
          action: 'verifier_modify',
          actorId: userId,
          actorRole,
          metadata: {
            finalScore: scoreResult.overallScore,
            qaVerifierDeviation,
            auditCaseCreated: shouldCreateAuditCase,
          } as never,
        },
      });
    });

    this.outboundWebhooks.deliver(tenantId, 'evaluation.completed', {
      evaluationId: id,
      conversationId: ev.conversationId,
      workflowState: WorkflowState.LOCKED,
      finalScore: scoreResult.overallScore,
      passFail: scoreResult.passFail,
    });

    return {
      workflowState: WorkflowState.LOCKED,
      finalScore: scoreResult.overallScore,
      passFail: scoreResult.passFail,
    };
  }

  // ─── Verifier Reject ──────────────────────────────────────────────────────

  async verifierReject(
    tenantId: string,
    id: string,
    userId: string,
    actorRole: string,
    dto: VerifierRejectDto,
  ) {
    const db = await this.getDb(tenantId);
    const ev = await db.evaluation.findUnique({ where: { id } });
    if (!ev)
      throw new NotFoundException({
        code: 'EVALUATION_NOT_FOUND',
        message: 'Evaluation not found',
      });

    if (ev.workflowState !== WorkflowState.VERIFIER_IN_PROGRESS) {
      throw new ConflictException({
        code: 'INVALID_STATE',
        message: 'Evaluation is not in VERIFIER_IN_PROGRESS',
      });
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
          metadata: {
            reason: dto.reason,
            workflowState: { from: 'VERIFIER_IN_PROGRESS', to: 'QA_PENDING' },
          } as never,
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

  async retryAiFailed(tenantId: string, evaluationId: string, actorId: string, actorRole: string) {
    if (!this.evalQueue) {
      throw new BadRequestException({
        code: 'QUEUE_UNAVAILABLE',
        message: 'Redis queue is unavailable. Cannot retry AI processing.',
      });
    }

    const db = await this.getDb(tenantId);
    const ev = await db.evaluation.findUnique({ where: { id: evaluationId } });
    if (!ev) {
      throw new NotFoundException({ code: 'EVALUATION_NOT_FOUND', message: 'Evaluation not found' });
    }
    if (ev.workflowState !== WorkflowState.AI_FAILED) {
      throw new ConflictException({
        code: 'INVALID_STATE',
        message: `Only AI_FAILED evaluations can be retried (current: ${ev.workflowState})`,
      });
    }

    await db.$transaction([
      db.evaluation.update({
        where: { id: evaluationId },
        data: {
          workflowState: WorkflowState.AI_PENDING,
          escalationReason: null,
          isEscalated: false,
        },
      }),
      db.conversation.update({
        where: { id: ev.conversationId },
        data: { status: 'PENDING' },
      }),
      db.workflowQueue.deleteMany({ where: { evaluationId } }),
      db.auditLog.create({
        data: {
          evaluationId,
          entityType: 'evaluation',
          entityId: evaluationId,
          action: 'ai_retry_requested',
          actorId,
          actorRole,
          metadata: {
            workflowState: { from: 'AI_FAILED', to: 'AI_PENDING' },
          } as never,
        },
      }),
    ]);

    await this.evalQueue.add(
      'eval-process',
      {
        tenantId,
        conversationId: ev.conversationId,
        evaluationId: ev.id,
        formDefinitionId: ev.formDefinitionId,
        formVersion: ev.formVersion,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 1000 },
      },
    );

    return { workflowState: WorkflowState.AI_PENDING, queued: true };
  }

  async exportAuditLogCsv(
    tenantId: string,
    from?: Date,
    to?: Date,
    evaluationId?: string,
  ): Promise<string> {
    const db = await this.getDb(tenantId);

    const logs = await db.auditLog.findMany({
      where: {
        ...(evaluationId ? { evaluationId } : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    });

    const escapeCsv = (value: unknown) => {
      if (value === null || value === undefined) return '';
      const str = typeof value === 'string' ? value : JSON.stringify(value);
      const escaped = str.replace(/"/g, '""');
      return `"${escaped}"`;
    };

    const header = [
      'id',
      'createdAt',
      'evaluationId',
      'entityType',
      'entityId',
      'action',
      'actorId',
      'actorRole',
      'metadata',
      'before',
      'after',
    ].join(',');

    const rows = logs.map((log) =>
      [
        escapeCsv(log.id),
        escapeCsv(log.createdAt.toISOString()),
        escapeCsv(log.evaluationId),
        escapeCsv(log.entityType),
        escapeCsv(log.entityId),
        escapeCsv(log.action),
        escapeCsv(log.actorId),
        escapeCsv(log.actorRole),
        escapeCsv(log.metadata),
        escapeCsv(log.before),
        escapeCsv(log.after),
      ].join(','),
    );

    return [header, ...rows].join('\n');
  }

  // ─── Escalation Queue ─────────────────────────────────────────────────────

  async getEscalationQueue(tenantId: string, page = 1, limit = 20, search?: string) {
    const db = await this.getDb(tenantId);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { queueType: 'ESCALATION_QUEUE' };
    if (search?.trim()) {
      const s = search.trim();
      where.evaluation = {
        conversation: {
          OR: [
            { externalId: { contains: s, mode: 'insensitive' } },
            { channel: { contains: s, mode: 'insensitive' } },
            { agentName: { contains: s, mode: 'insensitive' } },
            { customerRef: { contains: s, mode: 'insensitive' } },
          ],
        },
      };
    }

    const [items, total] = await db.$transaction([
      db.workflowQueue.findMany({
        where,
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
              isEscalated: true,
              escalationReason: true,
              formDefinitionId: true,
              formVersion: true,
              conversation: {
                select: {
                  id: true,
                  channel: true,
                  agentName: true,
                  customerRef: true,
                  receivedAt: true,
                  externalId: true,
                },
              },
            },
          },
        },
      }),
      db.workflowQueue.count({ where }),
    ]);

    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getAuditQueue(tenantId: string, page = 1, limit = 20, search?: string) {
    const db = await this.getDb(tenantId);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { queueType: 'AUDIT_QUEUE' };
    if (search?.trim()) {
      const s = search.trim();
      where.evaluation = {
        conversation: {
          OR: [
            { externalId: { contains: s, mode: 'insensitive' } },
            { channel: { contains: s, mode: 'insensitive' } },
            { agentName: { contains: s, mode: 'insensitive' } },
            { customerRef: { contains: s, mode: 'insensitive' } },
          ],
        },
      };
    }

    const [items, total] = await db.$transaction([
      db.workflowQueue.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        include: {
          evaluation: {
            include: {
              conversation: {
                select: {
                  id: true,
                  channel: true,
                  agentName: true,
                  customerRef: true,
                  receivedAt: true,
                  externalId: true,
                },
              },
              auditCase: true,
            },
          },
        },
      }),
      db.workflowQueue.count({ where }),
    ]);

    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async resolveAuditCase(
    tenantId: string,
    auditCaseId: string,
    actorId: string,
    actorRole: string,
    dismiss = false,
    note?: string,
  ) {
    const db = await this.getDb(tenantId);
    const auditCase = await db.auditCase.findUnique({
      where: { id: auditCaseId },
      include: { evaluation: true },
    });

    if (!auditCase) {
      throw new NotFoundException({ code: 'AUDIT_CASE_NOT_FOUND', message: 'Audit case not found' });
    }
    if (auditCase.status !== 'OPEN') {
      throw new ConflictException({
        code: 'AUDIT_CASE_ALREADY_CLOSED',
        message: 'Audit case is already closed',
      });
    }

    const status = dismiss ? 'DISMISSED' : 'RESOLVED';
    const now = new Date();

    await db.$transaction([
      db.auditCase.update({
        where: { id: auditCaseId },
        data: {
          status,
          resolvedAt: now,
          resolvedBy: actorId,
          resolutionNote: note,
        },
      }),
      db.workflowQueue.deleteMany({ where: { evaluationId: auditCase.evaluationId, queueType: 'AUDIT_QUEUE' } }),
      db.auditLog.create({
        data: {
          evaluationId: auditCase.evaluationId,
          entityType: 'audit_case',
          entityId: auditCaseId,
          action: dismiss ? 'audit_case_dismissed' : 'audit_case_resolved',
          actorId,
          actorRole,
          metadata: {
            note,
            status,
          } as never,
        },
      }),
    ]);

    return { id: auditCaseId, status, resolvedAt: now.toISOString() };
  }
}

// Re-export the shape for use in the worker
type EvaluationResponseLayer = import('@qa/shared').EvaluationResponseLayer;
