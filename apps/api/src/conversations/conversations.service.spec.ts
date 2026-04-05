// Unit tests for ConversationsService
// Covers uploadConversations (LLM-enabled, LLM-disabled, plan limits, edge cases),
// listConversations, and getConversation.

// ─── Module-level mock state ───────────────────────────────────────────────────

let mockMasterDb: {
  tenant: { findUniqueOrThrow: jest.Mock };
  llmConfig: { findUnique: jest.Mock };
  usageMetric: { findUnique: jest.Mock; upsert: jest.Mock };
};

jest.mock('@qa/prisma-master', () => ({
  getMasterClient: jest.fn(() => mockMasterDb),
}));

jest.mock('@qa/config', () => ({
  getEnv: jest.fn(() => ({
    REDIS_ENABLED: 'true', // enable so evalQueue is instantiated (bullmq is mocked below)
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    REDIS_PASSWORD: undefined,
  })),
}));

// BullMQ Queue is mocked so no real Redis connection is attempted
let mockQueue: { add: jest.Mock; close: jest.Mock };

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => mockQueue),
  Worker: jest.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { TenantConnectionPool } from '../tenant/tenant-connection-pool.service';
import { UsageMeterService } from '../billing/usage-meter.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-1';
const CHANNEL = 'CHAT';
const ACTIVE_FORM = { id: 'form-1', version: 3 };
const CONV = { id: 'conv-1', externalId: 'ext-001' };
const EVALUATION = { id: 'eval-1', conversationId: CONV.id };

function singleConversationPayload(overrides: Record<string, unknown> = {}) {
  return {
    channel: CHANNEL,
    conversations: [
      {
        externalId: 'ext-001',
        agentId: 'agent-1',
        agentName: 'Alice',
        customerRef: 'cust-ref-1',
        content: { messages: [] },
        ...overrides,
      },
    ],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTenantDb() {
  const db: Record<string, unknown> = {
    conversation: {
      upsert: jest.fn().mockResolvedValue(CONV),
      findMany: jest.fn().mockResolvedValue([CONV]),
      findUnique: jest.fn().mockResolvedValue({ ...CONV, evaluation: null }),
      count: jest.fn().mockResolvedValue(1),
      update: jest.fn().mockResolvedValue(CONV),
    },
    evaluation: {
      findUnique: jest.fn().mockResolvedValue(null), // no pre-existing evaluation by default
      create: jest.fn().mockResolvedValue(EVALUATION),
    },
    workflowQueue: {
      upsert: jest.fn().mockResolvedValue({}),
    },
    formDefinition: {
      findFirst: jest.fn().mockResolvedValue(ACTIVE_FORM),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
  };

  db.$transaction = jest.fn().mockImplementation((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return (arg as (tx: unknown) => Promise<unknown>)(db);
  });

  return db;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ConversationsService', () => {
  let svc: ConversationsService;
  let mockPool: jest.Mocked<TenantConnectionPool>;
  let mockUsageMeter: jest.Mocked<UsageMeterService>;
  let mockTenantDb: ReturnType<typeof makeTenantDb>;

  beforeEach(() => {
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      close: jest.fn().mockResolvedValue(undefined),
    };

    mockMasterDb = {
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: TENANT_ID, plan: 'ENTERPRISE' }),
      },
      llmConfig: {
        findUnique: jest.fn().mockResolvedValue({ enabled: true }),
      },
      usageMetric: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };

    mockTenantDb = makeTenantDb();

    mockPool = {
      getClient: jest.fn().mockResolvedValue(mockTenantDb),
    } as unknown as jest.Mocked<TenantConnectionPool>;

    mockUsageMeter = {
      recordConversation: jest.fn().mockResolvedValue(undefined),
      getMonthlyConversationCount: jest.fn().mockResolvedValue(0),
      recordAiUsage: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<UsageMeterService>;

    svc = new ConversationsService(mockPool, mockUsageMeter);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── uploadConversations — validation guards ────────────────────────────────

  describe('uploadConversations — validation', () => {
    it('throws BadRequestException (EMPTY_PAYLOAD) when conversations array is empty', async () => {
      await expect(
        svc.uploadConversations(TENANT_ID, { channel: CHANNEL, conversations: [] }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        svc.uploadConversations(TENANT_ID, { channel: CHANNEL, conversations: [] }),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'EMPTY_PAYLOAD' }) });
    });

    it('throws BadRequestException (BATCH_TOO_LARGE) when more than 500 conversations are provided', async () => {
      const conversations = Array.from({ length: 501 }, (_, i) => ({
        externalId: `ext-${i}`,
        content: {},
      }));

      await expect(
        svc.uploadConversations(TENANT_ID, { channel: CHANNEL, conversations }),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'BATCH_TOO_LARGE' }) });
    });

    it('throws BadRequestException (PLAN_LIMIT_EXCEEDED) when monthly limit is fully used', async () => {
      // BASIC plan: 500 conversations/month
      mockMasterDb.tenant.findUniqueOrThrow.mockResolvedValue({ id: TENANT_ID, plan: 'BASIC' });
      mockUsageMeter.getMonthlyConversationCount.mockResolvedValue(500); // limit reached

      await expect(
        svc.uploadConversations(TENANT_ID, singleConversationPayload()),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'PLAN_LIMIT_EXCEEDED' }),
      });
    });

    it('throws BadRequestException (PLAN_LIMIT_WOULD_EXCEED) when upload exceeds remaining quota', async () => {
      mockMasterDb.tenant.findUniqueOrThrow.mockResolvedValue({ id: TENANT_ID, plan: 'BASIC' });
      mockUsageMeter.getMonthlyConversationCount.mockResolvedValue(498); // 2 remaining

      const conversations = Array.from({ length: 5 }, (_, i) => ({
        externalId: `ext-${i}`,
        content: {},
      }));

      await expect(
        svc.uploadConversations(TENANT_ID, { channel: CHANNEL, conversations }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'PLAN_LIMIT_WOULD_EXCEED' }),
      });
    });
  });

  // ─── uploadConversations — no active form ──────────────────────────────────

  describe('uploadConversations — no active form', () => {
    it('returns evaluated: 0 when no published form is found for the channel', async () => {
      (mockTenantDb.formDefinition as Record<string, jest.Mock>).findFirst.mockResolvedValue(null);

      const result = await svc.uploadConversations(TENANT_ID, singleConversationPayload());

      expect(result).toEqual({ uploaded: 1, evaluated: 0 });
      expect((mockTenantDb.evaluation as Record<string, jest.Mock>).create).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  // ─── uploadConversations — LLM enabled path ───────────────────────────────

  describe('uploadConversations — LLM enabled', () => {
    it('creates evaluation in AI_PENDING state and enqueues eval:process job', async () => {
      mockMasterDb.llmConfig.findUnique.mockResolvedValue({ enabled: true });

      const result = await svc.uploadConversations(TENANT_ID, singleConversationPayload());

      expect(result).toEqual({ uploaded: 1, evaluated: 1 });

      expect((mockTenantDb.evaluation as Record<string, jest.Mock>).create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ workflowState: 'AI_PENDING' }),
        }),
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        'eval-process',
        expect.objectContaining({
          tenantId: TENANT_ID,
          conversationId: CONV.id,
          evaluationId: EVALUATION.id,
          formDefinitionId: ACTIVE_FORM.id,
          formVersion: ACTIVE_FORM.version,
        }),
        expect.objectContaining({ attempts: 3 }),
      );
    });

    it('does NOT create workflowQueue entry or update conversation status when LLM is enabled', async () => {
      mockMasterDb.llmConfig.findUnique.mockResolvedValue({ enabled: true });

      await svc.uploadConversations(TENANT_ID, singleConversationPayload());

      expect((mockTenantDb.workflowQueue as Record<string, jest.Mock>).upsert).not.toHaveBeenCalled();
      // Conversation update only happens in the LLM-disabled $transaction — not here
      // The second $transaction call should not happen
      const txCalls = (mockTenantDb as Record<string, jest.Mock>).$transaction.mock.calls;
      // Only the initial upsert transaction should be called
      expect(txCalls).toHaveLength(1);
    });

    it('does not throw when the BullMQ enqueue fails', async () => {
      mockMasterDb.llmConfig.findUnique.mockResolvedValue({ enabled: true });
      mockQueue.add.mockRejectedValueOnce(new Error('Redis connection refused'));

      // Should resolve normally — queue failure is swallowed with a console.warn
      await expect(
        svc.uploadConversations(TENANT_ID, singleConversationPayload()),
      ).resolves.toMatchObject({ uploaded: 1, evaluated: 1 });
    });
  });

  // ─── uploadConversations — LLM disabled path ──────────────────────────────

  describe('uploadConversations — LLM disabled', () => {
    beforeEach(() => {
      mockMasterDb.llmConfig.findUnique.mockResolvedValue({ enabled: false });
    });

    it('creates evaluation in QA_PENDING state', async () => {
      await svc.uploadConversations(TENANT_ID, singleConversationPayload());

      expect((mockTenantDb.evaluation as Record<string, jest.Mock>).create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ workflowState: 'QA_PENDING' }),
        }),
      );
    });

    it('does NOT enqueue an eval:process job', async () => {
      await svc.uploadConversations(TENANT_ID, singleConversationPayload());

      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('upserts a QA_QUEUE workflowQueue entry and sets conversation status to QA_REVIEW in a transaction', async () => {
      await svc.uploadConversations(TENANT_ID, singleConversationPayload());

      const txCalls = (mockTenantDb as Record<string, jest.Mock>).$transaction.mock.calls;
      // First call: conversation upserts; second call: workflowQueue + conversation.update
      expect(txCalls).toHaveLength(2);

      // Verify workflowQueue.upsert was called with QA_QUEUE
      expect((mockTenantDb.workflowQueue as Record<string, jest.Mock>).upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ queueType: 'QA_QUEUE' }),
        }),
      );

      // Verify conversation.update was called with status QA_REVIEW
      expect((mockTenantDb.conversation as Record<string, jest.Mock>).update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CONV.id },
          data: { status: 'QA_REVIEW' },
        }),
      );
    });
  });

  // ─── uploadConversations — no LLM config ──────────────────────────────────

  describe('uploadConversations — no LLM config record', () => {
    it('treats missing LLM config same as disabled (QA_PENDING, no queue enqueue)', async () => {
      mockMasterDb.llmConfig.findUnique.mockResolvedValue(null); // no record at all

      await svc.uploadConversations(TENANT_ID, singleConversationPayload());

      expect((mockTenantDb.evaluation as Record<string, jest.Mock>).create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ workflowState: 'QA_PENDING' }),
        }),
      );
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  // ─── uploadConversations — duplicate detection ────────────────────────────

  describe('uploadConversations — duplicate detection', () => {
    it('skips evaluation creation when a conversation already has an evaluation', async () => {
      // Simulate the evaluation already exists for this conversation
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(EVALUATION);

      await svc.uploadConversations(TENANT_ID, singleConversationPayload());

      // Conversation is still uploaded (upsert ran), but no new evaluation created
      expect((mockTenantDb.evaluation as Record<string, jest.Mock>).create).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  // ─── uploadConversations — ENTERPRISE plan (no limit check) ───────────────

  describe('uploadConversations — ENTERPRISE plan', () => {
    it('bypasses the monthly limit check and processes all conversations', async () => {
      mockMasterDb.tenant.findUniqueOrThrow.mockResolvedValue({ id: TENANT_ID, plan: 'ENTERPRISE' });

      const conversations = Array.from({ length: 10 }, (_, i) => ({
        externalId: `ext-${i}`,
        content: {},
      }));

      // Each conversation.upsert returns a unique object
      (mockTenantDb.conversation as Record<string, jest.Mock>).upsert.mockImplementation(
        (args: { create: { externalId: string } }) =>
          Promise.resolve({ id: `conv-${args.create.externalId}` }),
      );

      const result = await svc.uploadConversations(TENANT_ID, { channel: CHANNEL, conversations });

      expect(result.uploaded).toBe(10);
      expect(mockUsageMeter.getMonthlyConversationCount).not.toHaveBeenCalled();
    });
  });

  // ─── listConversations ─────────────────────────────────────────────────────

  describe('listConversations', () => {
    it('returns paginated result with items and pagination metadata', async () => {
      (mockTenantDb.conversation as Record<string, jest.Mock>).findMany.mockResolvedValue([CONV]);
      (mockTenantDb.conversation as Record<string, jest.Mock>).count.mockResolvedValue(1);

      const result = await svc.listConversations(TENANT_ID, { page: 1, limit: 20 });

      expect(result).toMatchObject({
        items: [CONV],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });
    });

    it('applies status filter to query when provided', async () => {
      (mockTenantDb.conversation as Record<string, jest.Mock>).findMany.mockResolvedValue([]);
      (mockTenantDb.conversation as Record<string, jest.Mock>).count.mockResolvedValue(0);

      await svc.listConversations(TENANT_ID, { page: 1, limit: 20, status: 'QA_REVIEW' as never });

      expect((mockTenantDb.conversation as Record<string, jest.Mock>).findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'QA_REVIEW' }),
        }),
      );
    });

    it('defaults to page 1 and limit 20 when not provided', async () => {
      (mockTenantDb.conversation as Record<string, jest.Mock>).findMany.mockResolvedValue([]);
      (mockTenantDb.conversation as Record<string, jest.Mock>).count.mockResolvedValue(0);

      await svc.listConversations(TENANT_ID, {});

      expect((mockTenantDb.conversation as Record<string, jest.Mock>).findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('uses enum-safe exact match for channel when search is a channel value', async () => {
      (mockTenantDb.conversation as Record<string, jest.Mock>).findMany.mockResolvedValue([]);
      (mockTenantDb.conversation as Record<string, jest.Mock>).count.mockResolvedValue(0);

      await svc.listConversations(TENANT_ID, { page: 1, limit: 20, search: 'chat' });

      expect((mockTenantDb.conversation as Record<string, jest.Mock>).findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([expect.objectContaining({ channel: 'CHAT' })]),
          }),
        }),
      );
    });
  });

  // ─── getConversation ───────────────────────────────────────────────────────

  describe('getConversation', () => {
    it('returns the conversation when found', async () => {
      const fullConv = { ...CONV, evaluation: { ...EVALUATION, passFail: null } };
      (mockTenantDb.conversation as Record<string, jest.Mock>).findUnique.mockResolvedValue(fullConv);

      const result = await svc.getConversation(TENANT_ID, CONV.id);

      expect(result).toEqual(fullConv);
    });

    it('throws NotFoundException (CONVERSATION_NOT_FOUND) when conversation does not exist', async () => {
      (mockTenantDb.conversation as Record<string, jest.Mock>).findUnique.mockResolvedValue(null);

      await expect(svc.getConversation(TENANT_ID, 'no-such-id')).rejects.toThrow(NotFoundException);
      await expect(svc.getConversation(TENANT_ID, 'no-such-id')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CONVERSATION_NOT_FOUND' }),
      });
    });
  });
});
