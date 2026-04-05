import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { getMasterClient } from '@qa/prisma-master';
import { Queue } from 'bullmq';
import { TenantConnectionPool } from '../tenant/tenant-connection-pool.service';
import { UsageMeterService } from '../billing/usage-meter.service';
import { ListConversationsDto } from './dto/conversations.dto';
import { QUEUE_NAMES, EvalProcessJobPayload, PLAN_LIMITS, PlanType } from '@qa/shared';
import { getEnv } from '@qa/config';

@Injectable()
export class ConversationsService {
  private static readonly CHANNEL_SEARCH_VALUES = ['CHAT', 'EMAIL', 'CALL', 'SOCIAL'] as const;
  private readonly masterDb = getMasterClient();
  private readonly evalQueue: Queue<EvalProcessJobPayload> | null = null;

  constructor(
    @Inject(TenantConnectionPool)
    private readonly pool: TenantConnectionPool,
    private readonly usageMeter: UsageMeterService,
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

  private async getTenantDb(tenantId: string) {
    return this.pool.getClient(tenantId);
  }

  private derivePassFail(
    score: number | null | undefined,
    passMark: number | null | undefined,
    fallback: boolean | null | undefined,
  ): boolean | null {
    if (typeof score === 'number' && typeof passMark === 'number') {
      return score >= passMark;
    }
    return fallback ?? null;
  }

  private parseSearchChannel(value: string) {
    const normalized = value.trim().toUpperCase();
    return (ConversationsService.CHANNEL_SEARCH_VALUES as readonly string[]).includes(normalized)
      ? normalized
      : null;
  }

  async listConversations(tenantId: string, query: ListConversationsDto) {
    const db = await this.getTenantDb(tenantId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.agentId) where.agentId = query.agentId;
    if (query.search?.trim()) {
      const s = query.search.trim();
      const orFilters: Array<Record<string, unknown>> = [
        { externalId: { contains: s, mode: 'insensitive' } },
        { agentName: { contains: s, mode: 'insensitive' } },
        { customerRef: { contains: s, mode: 'insensitive' } },
      ];
      const searchedChannel = this.parseSearchChannel(s);
      if (searchedChannel) {
        orFilters.push({ channel: searchedChannel });
      }
      where.OR = orFilters;
    }

    const [items, total] = await db.$transaction([
      db.conversation.findMany({
        where,
        skip,
        take: limit,
        orderBy: { receivedAt: 'desc' },
        select: {
          id: true,
          externalId: true,
          channel: true,
          agentName: true,
          customerRef: true,
          status: true,
          receivedAt: true,
          evaluation: {
            select: {
              workflowState: true,
              aiScore: true,
              qaScore: true,
              verifierScore: true,
              finalScore: true,
              passFail: true,
              formDefinition: {
                select: {
                  scoringStrategy: true,
                },
              },
            },
          },
        },
      }),
      db.conversation.count({ where }),
    ]);

    const normalizedItems = items.map((item) => {
      if (!item.evaluation) return item;

      const passMark =
        typeof item.evaluation.formDefinition?.scoringStrategy === 'object' &&
        item.evaluation.formDefinition?.scoringStrategy &&
        'passMark' in item.evaluation.formDefinition.scoringStrategy &&
        typeof item.evaluation.formDefinition.scoringStrategy.passMark === 'number'
          ? item.evaluation.formDefinition.scoringStrategy.passMark
          : null;

      const { formDefinition, ...evaluation } = item.evaluation;
      return {
        ...item,
        evaluation: {
          ...evaluation,
          passFail: this.derivePassFail(item.evaluation.finalScore, passMark, item.evaluation.passFail),
        },
      };
    });

    return {
      items: normalizedItems,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getConversation(tenantId: string, id: string) {
    const db = await this.getTenantDb(tenantId);
    const conv = await db.conversation.findUnique({
      where: { id },
      include: {
        evaluation: {
          include: {
            formDefinition: {
              select: {
                scoringStrategy: true,
              },
            },
          },
        },
      },
    });
    if (!conv)
      throw new NotFoundException({
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      });

    if (!conv.evaluation) return conv;

    const passMark =
      typeof conv.evaluation.formDefinition?.scoringStrategy === 'object' &&
      conv.evaluation.formDefinition?.scoringStrategy &&
      'passMark' in conv.evaluation.formDefinition.scoringStrategy &&
      typeof conv.evaluation.formDefinition.scoringStrategy.passMark === 'number'
        ? conv.evaluation.formDefinition.scoringStrategy.passMark
        : null;

    const { formDefinition, ...evaluation } = conv.evaluation;

    return {
      ...conv,
      evaluation: {
        ...evaluation,
        passFail: this.derivePassFail(conv.evaluation.finalScore, passMark, conv.evaluation.passFail),
      },
    };
  }

  async uploadConversations(
    tenantId: string,
    payload: {
      channel: string;
      conversations: Array<{
        externalId?: string;
        agentId?: string;
        agentName?: string;
        customerRef?: string;
        content: unknown;
        metadata?: unknown;
        receivedAt?: string;
      }>;
    },
  ) {
    if (!payload.conversations?.length) {
      throw new BadRequestException({
        code: 'EMPTY_PAYLOAD',
        message: 'No conversations provided',
      });
    }
    if (payload.conversations.length > 500) {
      throw new BadRequestException({
        code: 'BATCH_TOO_LARGE',
        message: 'Maximum 500 conversations per upload',
      });
    }

    // ── Plan limit check ────────────────────────────────────────────────────
    const tenant = await this.masterDb.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { plan: true },
    });
    const limits = PLAN_LIMITS[tenant.plan as PlanType];
    if (limits && limits.conversationsPerMonth !== 999_999) {
      const used = await this.usageMeter.getMonthlyConversationCount(tenantId);
      const remaining = limits.conversationsPerMonth - used;
      if (remaining <= 0) {
        throw new BadRequestException({
          code: 'PLAN_LIMIT_EXCEEDED',
          message: `Monthly conversation limit of ${limits.conversationsPerMonth} reached. Upgrade your plan to continue.`,
        });
      }
      if (payload.conversations.length > remaining) {
        throw new BadRequestException({
          code: 'PLAN_LIMIT_WOULD_EXCEED',
          message: `This upload would exceed your monthly limit. You have ${remaining} conversations remaining this month.`,
        });
      }
    }

    const db = await this.getTenantDb(tenantId);

    // Find the latest published form for the channel
    const activeForm = await db.formDefinition.findFirst({
      where: {
        status: 'PUBLISHED',
        channels: { path: [], array_contains: payload.channel },
      },
      orderBy: { version: 'desc' },
      select: { id: true, version: true },
    });

    // If LLM is disabled (or no config exists), route evaluations directly to QA.
    const llmConfig = await this.masterDb.llmConfig.findUnique({
      where: { tenantId },
      select: { enabled: true },
    });
    const llmEnabled = Boolean(llmConfig?.enabled);

    const created = await db.$transaction(
      payload.conversations.map((c) =>
        db.conversation.upsert({
          where: { externalId: c.externalId ?? `__no_ext_${Math.random()}` },
          create: {
            externalId: c.externalId,
            channel: payload.channel as never,
            agentId: c.agentId,
            agentName: c.agentName,
            customerRef: c.customerRef,
            content: c.content as never,
            metadata: c.metadata as never,
            receivedAt: c.receivedAt ? new Date(c.receivedAt) : new Date(),
          },
          update: {},
        }),
      ),
    );

    // Create evaluations + enqueue eval:process jobs for new conversations
    if (activeForm) {
      for (const conv of created) {
        // Avoid duplicate evaluations (upsert not natively supported via relation)
        const existing = await db.evaluation.findUnique({ where: { conversationId: conv.id } });
        if (existing) continue;

        const evaluation = await db.evaluation.create({
          data: {
            conversationId: conv.id,
            formDefinitionId: activeForm.id,
            formVersion: activeForm.version,
            workflowState: llmEnabled ? 'AI_PENDING' : 'QA_PENDING',
          },
        });

        if (llmEnabled && this.evalQueue) {
          // Mark conversation as actively being evaluated
          await db.conversation.update({
            where: { id: conv.id },
            data: { status: 'EVALUATING' },
          });
          try {
            await this.evalQueue.add(
              'eval-process',
              {
                tenantId,
                conversationId: conv.id,
                evaluationId: evaluation.id,
                formDefinitionId: activeForm.id,
                formVersion: activeForm.version,
              },
              { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
            );
          } catch (queueErr) {
            console.warn(
              '[Conversations] Failed to enqueue eval job:',
              (queueErr as Error).message,
            );
          }
        } else if (!llmEnabled) {
          await db.$transaction([
            db.workflowQueue.upsert({
              where: { evaluationId: evaluation.id },
              create: { evaluationId: evaluation.id, queueType: 'QA_QUEUE', priority: 5 },
              update: { queueType: 'QA_QUEUE', assignedTo: null, priority: 5 },
            }),
            db.conversation.update({
              where: { id: conv.id },
              data: { status: 'QA_REVIEW' },
            }),
          ]);
        }
      }
    }

    // Record usage asynchronously (don't block response)
    this.usageMeter.recordConversation(tenantId, created.length).catch(() => null);

    return { uploaded: created.length, evaluated: activeForm ? created.length : 0 };
  }

  // ─── Backfill evaluations for PENDING conversations ────────────────────────
  // Conversations uploaded before a form was published are left in PENDING with
  // no evaluation record.  This method retroactively creates evaluations for
  // every PENDING conversation that has no evaluation yet, using the current
  // latest published form for each conversation's channel.

  async backfillPendingEvaluations(tenantId: string): Promise<{
    processed: number;
    skipped: number;
    reason: string[];
  }> {
    const db = await this.getTenantDb(tenantId);

    const llmConfig = await this.masterDb.llmConfig.findUnique({
      where: { tenantId },
      select: { enabled: true },
    });
    const llmEnabled = Boolean(llmConfig?.enabled);

    // Fetch PENDING conversations. This covers two cases:
    //   1. No evaluation created yet (uploaded before a form was published).
    //   2. Evaluation exists but is stuck in AI_PENDING because LLM was later
    //      disabled or was never configured — conversation status was never
    //      advanced past PENDING.
    const pending = await db.conversation.findMany({
      where: { status: 'PENDING' },
      select: { id: true, channel: true },
    });

    if (pending.length === 0) {
      return { processed: 0, skipped: 0, reason: [] };
    }

    // Cache the latest published form per channel to avoid repeated DB hits
    const formCache = new Map<string, { id: string; version: number } | null>();

    const getForm = async (channel: string) => {
      if (formCache.has(channel)) return formCache.get(channel)!;
      const form = await db.formDefinition.findFirst({
        where: {
          status: 'PUBLISHED',
          channels: { path: [], array_contains: channel },
        },
        orderBy: { version: 'desc' },
        select: { id: true, version: true },
      });
      formCache.set(channel, form ?? null);
      return form ?? null;
    };

    let processed = 0;
    let skipped = 0;
    const reasons: string[] = [];

    for (const conv of pending) {
      const existing = await db.evaluation.findUnique({ where: { conversationId: conv.id } });

      // Case 2: evaluation exists and is AI_PENDING but LLM is now disabled.
      // Transition it directly to QA_PENDING so it surfaces in the QA queue.
      if (existing && existing.workflowState === 'AI_PENDING' && !llmEnabled) {
        const form = await getForm(conv.channel);
        await db.$transaction([
          db.evaluation.update({
            where: { id: existing.id },
            data: { workflowState: 'QA_PENDING' },
          }),
          db.workflowQueue.upsert({
            where: { evaluationId: existing.id },
            create: { evaluationId: existing.id, queueType: 'QA_QUEUE', priority: 5 },
            update: { queueType: 'QA_QUEUE', assignedTo: null, priority: 5 },
          }),
          db.conversation.update({
            where: { id: conv.id },
            data: { status: 'QA_REVIEW' },
          }),
        ]);
        processed++;
        continue;
      }

      // Case 1: no evaluation at all — skip if evaluation exists in any other state
      if (existing) {
        skipped++;
        continue;
      }

      const form = await getForm(conv.channel);
      if (!form) {
        skipped++;
        const msg = `No published form for channel ${conv.channel}`;
        if (!reasons.includes(msg)) reasons.push(msg);
        continue;
      }

      const evaluation = await db.evaluation.create({
        data: {
          conversationId: conv.id,
          formDefinitionId: form.id,
          formVersion: form.version,
          workflowState: llmEnabled ? 'AI_PENDING' : 'QA_PENDING',
        },
      });

      if (llmEnabled && this.evalQueue) {
        try {
          await this.evalQueue.add(
            'eval-process',
            {
              tenantId,
              conversationId: conv.id,
              evaluationId: evaluation.id,
              formDefinitionId: form.id,
              formVersion: form.version,
            },
            { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
          );
        } catch (queueErr) {
          console.warn('[Backfill] Failed to enqueue eval job:', (queueErr as Error).message);
        }
      } else if (!llmEnabled) {
        await db.$transaction([
          db.workflowQueue.upsert({
            where: { evaluationId: evaluation.id },
            create: { evaluationId: evaluation.id, queueType: 'QA_QUEUE', priority: 5 },
            update: { queueType: 'QA_QUEUE', assignedTo: null, priority: 5 },
          }),
          db.conversation.update({
            where: { id: conv.id },
            data: { status: 'QA_REVIEW' },
          }),
        ]);
      }

      processed++;
    }

    return { processed, skipped, reason: reasons };
  }

  async remapCorruptedQaPendingEvaluations(tenantId: string): Promise<{
    remapped: number;
    skipped: number;
    reason: string[];
  }> {
    const db = await this.getTenantDb(tenantId);

    const evaluations = await db.evaluation.findMany({
      where: { workflowState: 'QA_PENDING' },
      include: {
        formDefinition: {
          select: {
            id: true,
            version: true,
            sections: true,
            questions: true,
          },
        },
        conversation: {
          select: {
            channel: true,
          },
        },
      },
    });

    if (!evaluations.length) {
      return { remapped: 0, skipped: 0, reason: [] };
    }

    const validFormsByChannel = new Map<string, { id: string; version: number } | null>();
    const reasons: string[] = [];
    let remapped = 0;
    let skipped = 0;

    const isCorruptedForm = (sections: unknown, questions: unknown): boolean => {
      const sec = Array.isArray(sections) ? sections : [];
      const q = Array.isArray(questions) ? questions : [];
      const hasValidSection = sec.some(
        (s) =>
          typeof s === 'object' &&
          s !== null &&
          !Array.isArray(s) &&
          typeof (s as Record<string, unknown>).id === 'string' &&
          typeof (s as Record<string, unknown>).title === 'string',
      );
      const hasValidQuestion = q.some(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          !Array.isArray(item) &&
          typeof (item as Record<string, unknown>).id === 'string' &&
          typeof (item as Record<string, unknown>).key === 'string',
      );
      return !hasValidSection || !hasValidQuestion;
    };

    const getValidFormForChannel = async (channel: string) => {
      if (validFormsByChannel.has(channel)) return validFormsByChannel.get(channel)!;

      const candidates = await db.formDefinition.findMany({
        where: {
          status: 'PUBLISHED',
          channels: { path: [], array_contains: channel },
        },
        orderBy: { version: 'desc' },
        select: {
          id: true,
          version: true,
          sections: true,
          questions: true,
        },
      });

      const valid = candidates.find((f) => !isCorruptedForm(f.sections, f.questions));
      const mapped = valid ? { id: valid.id, version: valid.version } : null;
      validFormsByChannel.set(channel, mapped);
      return mapped;
    };

    for (const ev of evaluations) {
      const corrupted = isCorruptedForm(ev.formDefinition.sections, ev.formDefinition.questions);
      if (!corrupted) {
        skipped++;
        continue;
      }

      const replacement = await getValidFormForChannel(ev.conversation.channel);
      if (!replacement) {
        skipped++;
        const msg = `No valid published form found for channel ${ev.conversation.channel}`;
        if (!reasons.includes(msg)) reasons.push(msg);
        continue;
      }

      if (replacement.id === ev.formDefinitionId && replacement.version === ev.formVersion) {
        skipped++;
        continue;
      }

      await db.evaluation.update({
        where: { id: ev.id },
        data: {
          formDefinitionId: replacement.id,
          formVersion: replacement.version,
        },
      });
      remapped++;
    }

    return { remapped, skipped, reason: reasons };
  }
}
