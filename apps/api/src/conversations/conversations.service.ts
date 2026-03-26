import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { getMasterClient } from '@qa/prisma-master';
import { Queue } from 'bullmq';
import { TenantConnectionPool } from '../tenant/tenant-connection-pool.service';
import { ListConversationsDto } from './dto/conversations.dto';
import { QUEUE_NAMES, EvalProcessJobPayload } from '@qa/shared';
import { getEnv } from '@qa/config';

@Injectable()
export class ConversationsService {
  private readonly masterDb = getMasterClient();
  private readonly evalQueue: Queue<EvalProcessJobPayload> | null = null;

  constructor(
    @Inject(TenantConnectionPool)
    private readonly pool: TenantConnectionPool,
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

  async listConversations(tenantId: string, query: ListConversationsDto) {
    const db = await this.getTenantDb(tenantId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.agentId) where.agentId = query.agentId;

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
              finalScore: true,
              passFail: true,
            },
          },
        },
      }),
      db.conversation.count({ where }),
    ]);

    return {
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getConversation(tenantId: string, id: string) {
    const db = await this.getTenantDb(tenantId);
    const conv = await db.conversation.findUnique({
      where: { id },
      include: { evaluation: true },
    });
    if (!conv)
      throw new NotFoundException({
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      });
    return conv;
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
            workflowState: 'AI_PENDING',
          },
        });

        if (this.evalQueue) {
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
        }
      }
    }

    return { uploaded: created.length, evaluated: activeForm ? created.length : 0 };
  }
}
