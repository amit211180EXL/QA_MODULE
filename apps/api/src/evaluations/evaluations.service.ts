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

    const where: Record<string, unknown> = {
      workflowState: { in: [WorkflowState.QA_PENDING, WorkflowState.QA_IN_PROGRESS] },
    };
    if (search?.trim()) {
      const s = search.trim();
      where.conversation = {
        OR: [
          { externalId: { contains: s, mode: 'insensitive' } },
          { channel: { contains: s, mode: 'insensitive' } },
          { agentName: { contains: s, mode: 'insensitive' } },
          { customerRef: { contains: s, mode: 'insensitive' } },
        ],
      };
    }

    const [rows, total] = await db.$transaction([
      db.evaluation.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ qaStartedAt: 'desc' }, { createdAt: 'desc' }],
        include: {
          workflowQueue: {
            select: {
              id: true,
              queueType: true,
              priority: true,
              assignedTo: true,
              dueBy: true,
              createdAt: true,
              updatedAt: true,
            },
          },
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
      }),
      db.evaluation.count({ where }),
    ]);

    const items = rows.map((row) => {
      const queue = row.workflowQueue;
      return {
        id: queue?.id ?? `qa-${row.id}`,
        evaluationId: row.id,
        queueType: queue?.queueType ?? 'QA_QUEUE',
        priority: queue?.priority ?? 5,
        assignedTo: queue?.assignedTo ?? row.qaUserId ?? null,
        dueBy: queue?.dueBy ?? null,
        createdAt: queue?.createdAt ?? row.createdAt,
        updatedAt: queue?.updatedAt ?? row.updatedAt,
        evaluation: {
          id: row.id,
          workflowState: row.workflowState,
          aiScore: row.aiScore,
          qaScore: row.qaScore,
          verifierRejectReason: row.verifierRejectReason,
          verifierRejectedAt: row.verifierRejectedAt,
          formDefinitionId: row.formDefinitionId,
          formVersion: row.formVersion,
          conversation: row.conversation,
        },
      };
    });

    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  // ─── Verifier Queue ────────────────────────────────────────────────────────

  async getVerifierQueue(tenantId: string, page = 1, limit = 20, search?: string) {
    const db = await this.getDb(tenantId);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      workflowState: {
        in: [
          WorkflowState.QA_COMPLETED,
          WorkflowState.VERIFIER_PENDING,
          WorkflowState.VERIFIER_IN_PROGRESS,
        ],
      },
    };
    if (search?.trim()) {
      const s = search.trim();
      where.conversation = {
        OR: [
          { externalId: { contains: s, mode: 'insensitive' } },
          { channel: { contains: s, mode: 'insensitive' } },
          { agentName: { contains: s, mode: 'insensitive' } },
          { customerRef: { contains: s, mode: 'insensitive' } },
        ],
      };
    }

    const [rows, total] = await db.$transaction([
      db.evaluation.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ verifierStartedAt: 'desc' }, { createdAt: 'desc' }],
        include: {
          workflowQueue: {
            select: {
              id: true,
              queueType: true,
              priority: true,
              assignedTo: true,
              dueBy: true,
              createdAt: true,
              updatedAt: true,
            },
          },
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
      }),
      db.evaluation.count({ where }),
    ]);

    const items = rows.map((row) => {
      const queue = row.workflowQueue;
      return {
        id: queue?.id ?? `verifier-${row.id}`,
        evaluationId: row.id,
        queueType: queue?.queueType ?? 'VERIFIER_QUEUE',
        priority: queue?.priority ?? 5,
        assignedTo: queue?.assignedTo ?? row.verifierUserId ?? null,
        dueBy: queue?.dueBy ?? null,
        createdAt: queue?.createdAt ?? row.createdAt,
        updatedAt: queue?.updatedAt ?? row.updatedAt,
        evaluation: {
          id: row.id,
          workflowState: row.workflowState,
          aiScore: row.aiScore,
          qaScore: row.qaScore,
          formDefinitionId: row.formDefinitionId,
          formVersion: row.formVersion,
          conversation: row.conversation,
        },
      };
    });

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
      db.workflowQueue.upsert({
        where: { evaluationId: id },
        create: {
          evaluationId: id,
          queueType: 'QA_QUEUE',
          assignedTo: userId,
          priority: 5,
        },
        update: { queueType: 'QA_QUEUE', assignedTo: userId },
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
      db.workflowQueue.upsert({
        where: { evaluationId: id },
        create: {
          evaluationId: id,
          queueType: 'VERIFIER_QUEUE',
          assignedTo: userId,
          priority: 5,
        },
        update: { queueType: 'VERIFIER_QUEUE', assignedTo: userId },
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

  // ─── Manual Assignment (Admin only) ─────────────────────────────────────────

  async manualAssign(
    tenantId: string,
    evaluationId: string,
    targetUserId: string,
    actorId: string,
    actorRole: string,
  ) {
    const db = await this.getDb(tenantId);
    const masterDb = getMasterClient();

    // Validate target user exists, is ACTIVE, and belongs to the same tenant
    const targetUser = await masterDb.user.findFirst({
      where: { id: targetUserId, tenantId, status: 'ACTIVE' },
      select: { id: true, role: true, name: true },
    });
    if (!targetUser) {
      throw new BadRequestException({
        code: 'INVALID_TARGET_USER',
        message: 'Target user is not found, inactive, or does not belong to this tenant',
      });
    }

    const ev = await db.evaluation.findUnique({
      where: { id: evaluationId },
      include: { workflowQueue: true },
    });
    if (!ev) {
      throw new NotFoundException({ code: 'EVALUATION_NOT_FOUND', message: 'Evaluation not found' });
    }

    // Determine valid states for assignment based on target user role
    const isQaAssignment = targetUser.role === 'QA' || targetUser.role === 'ADMIN';
    const isVerifierAssignment = targetUser.role === 'VERIFIER' || targetUser.role === 'ADMIN';

    const qaAssignableStates = [WorkflowState.QA_PENDING, WorkflowState.QA_IN_PROGRESS];
    const verifierAssignableStates = [
      WorkflowState.QA_COMPLETED,
      WorkflowState.VERIFIER_PENDING,
      WorkflowState.VERIFIER_IN_PROGRESS,
    ];

    const canAssignAsQa = isQaAssignment && qaAssignableStates.includes(ev.workflowState as WorkflowState);
    const canAssignAsVerifier = isVerifierAssignment && verifierAssignableStates.includes(ev.workflowState as WorkflowState);

    if (!canAssignAsQa && !canAssignAsVerifier) {
      throw new ConflictException({
        code: 'INVALID_ASSIGNMENT',
        message: `Cannot assign user with role ${targetUser.role} to evaluation in ${ev.workflowState} state`,
      });
    }

    const now = new Date();
    const previousAssignee = ev.workflowQueue?.assignedTo ?? null;

    if (canAssignAsQa) {
      await db.$transaction([
        db.evaluation.update({
          where: { id: evaluationId },
          data: {
            workflowState: WorkflowState.QA_IN_PROGRESS,
            qaUserId: targetUserId,
            qaStartedAt: ev.qaStartedAt ?? now,
          },
        }),
        db.workflowQueue.upsert({
          where: { evaluationId },
          create: { evaluationId, queueType: 'QA_QUEUE', assignedTo: targetUserId, priority: 5 },
          update: { assignedTo: targetUserId },
        }),
        db.auditLog.create({
          data: {
            evaluationId,
            entityType: 'evaluation',
            entityId: evaluationId,
            action: 'manual_assign',
            actorId,
            actorRole,
            metadata: {
              assignedTo: targetUserId,
              assignedToName: targetUser.name,
              previousAssignee,
              assignmentType: 'qa',
            } as never,
          },
        }),
      ]);
    } else {
      await db.$transaction([
        db.evaluation.update({
          where: { id: evaluationId },
          data: {
            workflowState: WorkflowState.VERIFIER_IN_PROGRESS,
            verifierUserId: targetUserId,
            verifierStartedAt: ev.verifierStartedAt ?? now,
          },
        }),
        db.workflowQueue.upsert({
          where: { evaluationId },
          create: { evaluationId, queueType: 'VERIFIER_QUEUE', assignedTo: targetUserId, priority: 5 },
          update: { assignedTo: targetUserId },
        }),
        db.auditLog.create({
          data: {
            evaluationId,
            entityType: 'evaluation',
            entityId: evaluationId,
            action: 'manual_assign',
            actorId,
            actorRole,
            metadata: {
              assignedTo: targetUserId,
              assignedToName: targetUser.name,
              previousAssignee,
              assignmentType: 'verifier',
            } as never,
          },
        }),
      ]);
    }

    return {
      evaluationId,
      assignedTo: targetUserId,
      assignedToName: targetUser.name,
      assignmentType: canAssignAsQa ? 'qa' : 'verifier',
    };
  }

  // ─── Round-Robin Auto-Assignment (Admin only) ────────────────────────────

  async roundRobinAssign(
    tenantId: string,
    queueType: string,
    actorId: string,
    actorRole: string,
    limit?: number,
  ) {
    const db = await this.getDb(tenantId);
    const masterDb = getMasterClient();

    // Validate queue type
    const validTypes = ['QA_QUEUE', 'VERIFIER_QUEUE'];
    if (!validTypes.includes(queueType)) {
      throw new BadRequestException({
        code: 'INVALID_QUEUE_TYPE',
        message: `Queue type must be one of: ${validTypes.join(', ')}`,
      });
    }

    // Get ACTIVE users with the appropriate role
    const targetRole = queueType === 'QA_QUEUE' ? 'QA' : 'VERIFIER';
    const eligibleUsers = await masterDb.user.findMany({
      where: { tenantId, status: 'ACTIVE', role: { in: [targetRole, 'ADMIN'] } },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });

    if (eligibleUsers.length === 0) {
      throw new BadRequestException({
        code: 'NO_ELIGIBLE_USERS',
        message: `No active ${targetRole} users available for assignment`,
      });
    }

    // Get unassigned queue items
    const unassigned = await db.workflowQueue.findMany({
      where: { queueType: queueType as any, assignedTo: null },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      take: limit ?? 1000,
      select: { id: true, evaluationId: true },
    });

    if (unassigned.length === 0) {
      return { assigned: 0, message: 'No unassigned items in queue' };
    }

    // Get current workload counts per user to find the least-loaded starting point
    const currentCounts = await db.workflowQueue.groupBy({
      by: ['assignedTo'],
      where: { queueType: queueType as any, assignedTo: { not: null } },
      _count: { _all: true },
    });
    const loadMap = new Map<string, number>();
    for (const u of eligibleUsers) loadMap.set(u.id, 0);
    for (const c of currentCounts) {
      if (c.assignedTo && loadMap.has(c.assignedTo)) {
        loadMap.set(c.assignedTo, c._count._all);
      }
    }

    // Sort users by current load (ascending) for fair distribution
    const sortedUsers = [...eligibleUsers].sort(
      (a, b) => (loadMap.get(a.id) ?? 0) - (loadMap.get(b.id) ?? 0),
    );

    const isQa = queueType === 'QA_QUEUE';
    const workflowState = isQa ? WorkflowState.QA_IN_PROGRESS : WorkflowState.VERIFIER_IN_PROGRESS;
    const now = new Date();
    const assignments: Array<{ evaluationId: string; userId: string; userName: string }> = [];

    // Distribute round-robin
    for (let i = 0; i < unassigned.length; i++) {
      const item = unassigned[i];
      const user = sortedUsers[i % sortedUsers.length];
      assignments.push({ evaluationId: item.evaluationId, userId: user.id, userName: user.name });
    }

    // Batch update in a transaction
    await db.$transaction([
      ...assignments.map((a) =>
        db.workflowQueue.update({
          where: { evaluationId: a.evaluationId },
          data: { assignedTo: a.userId },
        }),
      ),
      ...assignments.map((a) =>
        db.evaluation.update({
          where: { id: a.evaluationId },
          data: isQa
            ? { workflowState, qaUserId: a.userId, qaStartedAt: now }
            : { workflowState, verifierUserId: a.userId, verifierStartedAt: now },
        }),
      ),
      db.auditLog.create({
        data: {
          entityType: 'workflow_queue',
          entityId: queueType,
          action: 'round_robin_assign',
          actorId,
          actorRole,
          metadata: {
            queueType,
            totalAssigned: assignments.length,
            userDistribution: sortedUsers.map((u) => ({
              userId: u.id,
              name: u.name,
              count: assignments.filter((a) => a.userId === u.id).length,
            })),
          } as never,
        },
      }),
    ]);

    return {
      assigned: assignments.length,
      distribution: sortedUsers.map((u) => ({
        userId: u.id,
        name: u.name,
        count: assignments.filter((a) => a.userId === u.id).length,
      })),
    };
  }

  // ─── Reassign (Admin only — for on-leave / offline users) ─────────────────

  async reassign(
    tenantId: string,
    evaluationId: string,
    newUserId: string,
    actorId: string,
    actorRole: string,
    reason?: string,
  ) {
    const db = await this.getDb(tenantId);
    const masterDb = getMasterClient();

    const newUser = await masterDb.user.findFirst({
      where: { id: newUserId, tenantId, status: 'ACTIVE' },
      select: { id: true, role: true, name: true },
    });
    if (!newUser) {
      throw new BadRequestException({
        code: 'INVALID_TARGET_USER',
        message: 'Target user is not found, inactive, or does not belong to this tenant',
      });
    }

    const ev = await db.evaluation.findUnique({
      where: { id: evaluationId },
      include: { workflowQueue: true },
    });
    if (!ev) {
      throw new NotFoundException({ code: 'EVALUATION_NOT_FOUND', message: 'Evaluation not found' });
    }

    // Only allow reassignment of in-progress evaluations
    const isQaInProgress = ev.workflowState === WorkflowState.QA_IN_PROGRESS;
    const isVerifierInProgress = ev.workflowState === WorkflowState.VERIFIER_IN_PROGRESS;

    if (!isQaInProgress && !isVerifierInProgress) {
      throw new ConflictException({
        code: 'NOT_IN_PROGRESS',
        message: `Cannot reassign evaluation in ${ev.workflowState} state. Only QA_IN_PROGRESS or VERIFIER_IN_PROGRESS can be reassigned.`,
      });
    }

    const previousUserId = isQaInProgress ? ev.qaUserId : ev.verifierUserId;
    const now = new Date();

    if (isQaInProgress) {
      await db.$transaction([
        db.evaluation.update({
          where: { id: evaluationId },
          data: { qaUserId: newUserId, qaStartedAt: now },
        }),
        db.workflowQueue.updateMany({
          where: { evaluationId },
          data: { assignedTo: newUserId },
        }),
        db.auditLog.create({
          data: {
            evaluationId,
            entityType: 'evaluation',
            entityId: evaluationId,
            action: 'reassign',
            actorId,
            actorRole,
            metadata: {
              previousUserId,
              newUserId,
              newUserName: newUser.name,
              reason: reason ?? 'Admin reassignment',
              assignmentType: 'qa',
            } as never,
          },
        }),
      ]);
    } else {
      await db.$transaction([
        db.evaluation.update({
          where: { id: evaluationId },
          data: { verifierUserId: newUserId, verifierStartedAt: now },
        }),
        db.workflowQueue.updateMany({
          where: { evaluationId },
          data: { assignedTo: newUserId },
        }),
        db.auditLog.create({
          data: {
            evaluationId,
            entityType: 'evaluation',
            entityId: evaluationId,
            action: 'reassign',
            actorId,
            actorRole,
            metadata: {
              previousUserId,
              newUserId,
              newUserName: newUser.name,
              reason: reason ?? 'Admin reassignment',
              assignmentType: 'verifier',
            } as never,
          },
        }),
      ]);
    }

    return {
      evaluationId,
      previousUserId,
      newUserId,
      newUserName: newUser.name,
      assignmentType: isQaInProgress ? 'qa' : 'verifier',
    };
  }
}

// Re-export the shape for use in the worker
type EvaluationResponseLayer = import('@qa/shared').EvaluationResponseLayer;
