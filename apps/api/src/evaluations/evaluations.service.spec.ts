// Unit tests for EvaluationsService
// Covers: qaStart, qaSubmit (LLM-enabled, LLM-disabled, escalation),
//         verifierStart, verifierApprove.

// ─── Module-level mock state ───────────────────────────────────────────────────

let mockMasterDb: {
  escalationRule: { findFirst: jest.Mock };
  blindReviewSettings: { findUnique: jest.Mock };
};

jest.mock('@qa/prisma-master', () => ({
  getMasterClient: jest.fn(() => mockMasterDb),
}));

jest.mock('@qa/config', () => ({
  getEnv: jest.fn(() => ({
    REDIS_ENABLED: 'false', // prevents BullMQ from being created
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    REDIS_PASSWORD: undefined,
    MASTER_ENCRYPTION_KEY: 'test-enc-key-32-chars-long-here!!',
    JWT_SECRET: 'test-jwt-secret-at-least-32-chars-long!!',
  })),
}));

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn() })),
  Worker: jest.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────

import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { EvaluationsService } from './evaluations.service';
import { ScoringService } from './scoring.service';
import { TenantConnectionPool } from '../tenant/tenant-connection-pool.service';
import { OutboundWebhooksService } from '../webhooks/outbound-webhooks.service';
import { WorkflowState } from '@qa/shared';

// ─── Fixtures & form definition ───────────────────────────────────────────────

const TENANT_ID = 'tenant-1';
const EVAL_ID = 'eval-1';
const CONV_ID = 'conv-1';
const QA_USER_ID = 'qa-user-1';
const VERIFIER_USER_ID = 'verifier-user-1';

/**
 * Minimal form: 1 section (weight 100), 1 boolean question (weight 100).
 * boolean true  → normalizedAnswer 100 → sectionScore 100 → overallScore 100 (pass)
 * boolean false → normalizedAnswer 0   → sectionScore 0   → overallScore 0   (fail)
 */
const FORM_DEFINITION = {
  id: 'form-1',
  version: 1,
  sections: [{ id: 'sec_q', title: 'Quality', weight: 100, order: 1 }],
  questions: [
    {
      id: 'q1',
      sectionId: 'sec_q',
      key: 'resolved',
      label: 'Was the issue resolved?',
      type: 'boolean',
      required: true,
      weight: 100,
      order: 1,
      validation: { min: 0, max: 100 },
    },
  ],
  scoringStrategy: {
    type: 'weighted_sections',
    passMark: 70,
    scale: 100,
    roundingPolicy: 'round',
  },
};

/** AI filled this evaluation with resolved = true (score 100). */
const AI_RESPONSE_DATA = {
  answers: { resolved: { value: true, confidence: 0.95 } },
  sectionScores: { sec_q: 100 },
  overallScore: 100,
  passFail: true,
};

function makeBaseEvaluation(overrides: Record<string, unknown> = {}) {
  return {
    id: EVAL_ID,
    conversationId: CONV_ID,
    formDefinitionId: 'form-1',
    formVersion: 1,
    workflowState: WorkflowState.QA_PENDING,
    aiResponseData: AI_RESPONSE_DATA,
    aiScore: 100,
    qaScore: null,
    qaUserId: null,
    qaStartedAt: null,
    qaCompletedAt: null,
    qaAdjustedData: null,
    verifierUserId: null,
    verifierStartedAt: null,
    verifierCompletedAt: null,
    isEscalated: false,
    escalationReason: null,
    finalScore: null,
    passFail: null,
    formDefinition: FORM_DEFINITION,
    ...overrides,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTenantDb() {
  const db: Record<string, unknown> = {
    evaluation: {
      findUnique: jest.fn().mockResolvedValue(makeBaseEvaluation()),
      update: jest.fn().mockResolvedValue({}),
    },
    workflowQueue: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    conversation: {
      update: jest.fn().mockResolvedValue({}),
    },
    deviationRecord: {
      create: jest.fn().mockResolvedValue({}),
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

describe('EvaluationsService', () => {
  let svc: EvaluationsService;
  let mockPool: jest.Mocked<TenantConnectionPool>;
  let mockWebhooks: jest.Mocked<OutboundWebhooksService>;
  let mockTenantDb: ReturnType<typeof makeTenantDb>;

  beforeEach(() => {
    mockMasterDb = {
      escalationRule: {
        findFirst: jest.fn().mockResolvedValue(null), // defaults to threshold of 15
      },
      blindReviewSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    mockTenantDb = makeTenantDb();

    mockPool = {
      getClient: jest.fn().mockResolvedValue(mockTenantDb),
    } as unknown as jest.Mocked<TenantConnectionPool>;

    mockWebhooks = {
      deliver: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<OutboundWebhooksService>;

    svc = new EvaluationsService(mockPool, new ScoringService(), mockWebhooks);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── qaStart ───────────────────────────────────────────────────────────────

  describe('qaStart', () => {
    it('transitions QA_PENDING → QA_IN_PROGRESS and returns correct workflowState', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        makeBaseEvaluation({ workflowState: WorkflowState.QA_PENDING }),
      );

      const result = await svc.qaStart(TENANT_ID, EVAL_ID, QA_USER_ID, 'QA');

      expect(result).toEqual({ workflowState: WorkflowState.QA_IN_PROGRESS });
      expect((mockTenantDb as Record<string, jest.Mock>).$transaction).toHaveBeenCalled();
    });

    it('updates workflowState to QA_IN_PROGRESS and assigns qaUserId in the transaction', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        makeBaseEvaluation({ workflowState: WorkflowState.QA_PENDING }),
      );

      await svc.qaStart(TENANT_ID, EVAL_ID, QA_USER_ID, 'QA');

      expect((mockTenantDb.evaluation as Record<string, jest.Mock>).update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: EVAL_ID },
          data: expect.objectContaining({
            workflowState: WorkflowState.QA_IN_PROGRESS,
            qaUserId: QA_USER_ID,
          }),
        }),
      );
    });

    it('throws NotFoundException (EVALUATION_NOT_FOUND) when evaluation does not exist', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(null);

      await expect(svc.qaStart(TENANT_ID, 'no-such', QA_USER_ID, 'QA')).rejects.toThrow(
        NotFoundException,
      );
      await expect(svc.qaStart(TENANT_ID, 'no-such', QA_USER_ID, 'QA')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'EVALUATION_NOT_FOUND' }),
      });
    });

    it('throws ConflictException (INVALID_STATE) when evaluation is not in QA_PENDING state', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        makeBaseEvaluation({ workflowState: WorkflowState.AI_PENDING }),
      );

      await expect(svc.qaStart(TENANT_ID, EVAL_ID, QA_USER_ID, 'QA')).rejects.toThrow(
        ConflictException,
      );
      await expect(svc.qaStart(TENANT_ID, EVAL_ID, QA_USER_ID, 'QA')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'INVALID_STATE' }),
      });
    });
  });

  // ─── qaSubmit ──────────────────────────────────────────────────────────────

  describe('qaSubmit', () => {
    const IN_PROGRESS_EVAL = () =>
      makeBaseEvaluation({
        workflowState: WorkflowState.QA_IN_PROGRESS,
        qaUserId: QA_USER_ID,
        aiScore: 100,
        aiResponseData: AI_RESPONSE_DATA,
      });

    it('[LLM path] scores answers, transitions to QA_COMPLETED, and returns qaScore', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        IN_PROGRESS_EVAL(),
      );

      const result = await svc.qaSubmit(TENANT_ID, EVAL_ID, QA_USER_ID, 'QA', {
        adjustedAnswers: { resolved: { value: true } }, // same as AI answer
        feedback: 'Looks good',
        flags: [],
      });

      expect(result).toMatchObject({
        workflowState: WorkflowState.QA_COMPLETED,
        qaScore: 100,
        passFail: true,
        escalated: false,
      });
    });

    it('[LLM path] routes to VERIFIER_QUEUE when deviation is within escalation threshold', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        IN_PROGRESS_EVAL(), // aiScore = 100
      );
      // QA agrees with AI → deviation = 0
      await svc.qaSubmit(TENANT_ID, EVAL_ID, QA_USER_ID, 'QA', {
        adjustedAnswers: { resolved: { value: true } },
      });

      expect((mockTenantDb.workflowQueue as Record<string, jest.Mock>).upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ queueType: 'VERIFIER_QUEUE' }),
        }),
      );
    });

    it('[LLM path] escalates to ESCALATION_QUEUE when aiQaDeviation exceeds threshold', async () => {
      // AI scored 100 (resolved: true), QA will score 0 (resolved: false) → deviation = 100 > 15
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        IN_PROGRESS_EVAL(),
      );

      const result = await svc.qaSubmit(TENANT_ID, EVAL_ID, QA_USER_ID, 'QA', {
        adjustedAnswers: {
          resolved: { value: false, overrideReason: 'Issue was not actually resolved' },
        },
      });

      expect(result.escalated).toBe(true);
      expect((mockTenantDb.workflowQueue as Record<string, jest.Mock>).upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ queueType: 'ESCALATION_QUEUE', priority: 1 }),
        }),
      );
    });

    it('[LLM path] fires evaluation.escalated webhook when escalation occurs', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        IN_PROGRESS_EVAL(),
      );

      await svc.qaSubmit(TENANT_ID, EVAL_ID, QA_USER_ID, 'QA', {
        adjustedAnswers: {
          resolved: { value: false, overrideReason: 'Not resolved in follow-up' },
        },
      });

      expect(mockWebhooks.deliver).toHaveBeenCalledWith(
        TENANT_ID,
        'evaluation.escalated',
        expect.objectContaining({ evaluationId: EVAL_ID }),
      );
    });

    it('[LLM path] creates a deviation record when there is a score difference', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        IN_PROGRESS_EVAL(), // aiScore = 100
      );

      await svc.qaSubmit(TENANT_ID, EVAL_ID, QA_USER_ID, 'QA', {
        adjustedAnswers: {
          resolved: { value: false, overrideReason: 'Checked the follow-up ticket' },
        },
      });

      expect((mockTenantDb.deviationRecord as Record<string, jest.Mock>).create).toHaveBeenCalled();
    });

    it('[LLM path] throws BadRequestException (MISSING_OVERRIDE_REASON) when AI answer is changed without reason', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        IN_PROGRESS_EVAL(), // AI says resolved: true
      );

      await expect(
        svc.qaSubmit(TENANT_ID, EVAL_ID, QA_USER_ID, 'QA', {
          adjustedAnswers: { resolved: { value: false } }, // changed but no overrideReason
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        svc.qaSubmit(TENANT_ID, EVAL_ID, QA_USER_ID, 'QA', {
          adjustedAnswers: { resolved: { value: false } },
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'MISSING_OVERRIDE_REASON' }),
      });
    });

    it('[LLM disabled] accepts first-time QA answers with no overrideReason required', async () => {
      // No AI layer: aiResponseData is null, aiScore is null
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        makeBaseEvaluation({
          workflowState: WorkflowState.QA_IN_PROGRESS,
          qaUserId: QA_USER_ID,
          aiResponseData: null,
          aiScore: null,
        }),
      );

      // No overrideReason provided — should NOT throw since there are no AI answers to compare against
      await expect(
        svc.qaSubmit(TENANT_ID, EVAL_ID, QA_USER_ID, 'QA', {
          adjustedAnswers: { resolved: { value: true } },
        }),
      ).resolves.toMatchObject({ workflowState: WorkflowState.QA_COMPLETED });
    });

    it('[LLM disabled] produces NO deviation record when aiScore is null', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        makeBaseEvaluation({
          workflowState: WorkflowState.QA_IN_PROGRESS,
          qaUserId: QA_USER_ID,
          aiResponseData: null,
          aiScore: null,
        }),
      );

      await svc.qaSubmit(TENANT_ID, EVAL_ID, QA_USER_ID, 'QA', {
        adjustedAnswers: { resolved: { value: true } },
      });

      // No AI_VS_QA deviation created since there is no AI score baseline
      expect((mockTenantDb.deviationRecord as Record<string, jest.Mock>).create).not.toHaveBeenCalled();
    });

    it('[LLM disabled] escalated is false regardless of score when aiScore is null', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        makeBaseEvaluation({
          workflowState: WorkflowState.QA_IN_PROGRESS,
          qaUserId: QA_USER_ID,
          aiResponseData: null,
          aiScore: null,
        }),
      );

      const result = await svc.qaSubmit(TENANT_ID, EVAL_ID, QA_USER_ID, 'QA', {
        adjustedAnswers: { resolved: { value: false } }, // poor score, but no AI to compare against
      });

      expect(result.escalated).toBe(false);
    });

    it('throws ConflictException (ALREADY_SUBMITTED) when not in QA_IN_PROGRESS state', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        makeBaseEvaluation({ workflowState: WorkflowState.QA_COMPLETED, qaUserId: QA_USER_ID }),
      );

      await expect(
        svc.qaSubmit(TENANT_ID, EVAL_ID, QA_USER_ID, 'QA', {
          adjustedAnswers: { resolved: { value: true } },
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException (NOT_CLAIMED_BY_YOU) when a different user submits', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        makeBaseEvaluation({
          workflowState: WorkflowState.QA_IN_PROGRESS,
          qaUserId: 'another-user',
        }),
      );

      await expect(
        svc.qaSubmit(TENANT_ID, EVAL_ID, QA_USER_ID, 'QA', {
          adjustedAnswers: { resolved: { value: true } },
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when evaluation does not exist', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(null);

      await expect(
        svc.qaSubmit(TENANT_ID, EVAL_ID, QA_USER_ID, 'QA', {
          adjustedAnswers: {},
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('uses custom escalation threshold from master DB when configured', async () => {
      mockMasterDb.escalationRule.findFirst.mockResolvedValue({ qaDeviationThreshold: 80 });

      // AI score 100, QA score 0 → deviation 100 > 80 → escalated
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        IN_PROGRESS_EVAL(),
      );

      const result = await svc.qaSubmit(TENANT_ID, EVAL_ID, QA_USER_ID, 'QA', {
        adjustedAnswers: {
          resolved: { value: false, overrideReason: 'Override reason supplied' },
        },
      });

      expect(result.escalated).toBe(true);
    });

    it('does NOT escalate when deviation equals threshold (boundary: equal is not >)', async () => {
      mockMasterDb.escalationRule.findFirst.mockResolvedValue({ qaDeviationThreshold: 100 });

      // AI score 100, QA score 0 → deviation = 100, threshold = 100 → 100 > 100 is false
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        IN_PROGRESS_EVAL(),
      );

      const result = await svc.qaSubmit(TENANT_ID, EVAL_ID, QA_USER_ID, 'QA', {
        adjustedAnswers: {
          resolved: { value: false, overrideReason: 'Override reason supplied' },
        },
      });

      expect(result.escalated).toBe(false);
    });
  });

  // ─── verifierStart ─────────────────────────────────────────────────────────

  describe('verifierStart', () => {
    it('transitions QA_COMPLETED → VERIFIER_IN_PROGRESS', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        makeBaseEvaluation({ workflowState: WorkflowState.QA_COMPLETED }),
      );

      const result = await svc.verifierStart(TENANT_ID, EVAL_ID, VERIFIER_USER_ID, 'VERIFIER');

      expect(result).toEqual({ workflowState: WorkflowState.VERIFIER_IN_PROGRESS });
    });

    it('transitions VERIFIER_PENDING → VERIFIER_IN_PROGRESS', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        makeBaseEvaluation({ workflowState: WorkflowState.VERIFIER_PENDING }),
      );

      const result = await svc.verifierStart(TENANT_ID, EVAL_ID, VERIFIER_USER_ID, 'VERIFIER');

      expect(result).toEqual({ workflowState: WorkflowState.VERIFIER_IN_PROGRESS });
    });

    it('assigns the verifierUserId in the transaction', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        makeBaseEvaluation({ workflowState: WorkflowState.QA_COMPLETED }),
      );

      await svc.verifierStart(TENANT_ID, EVAL_ID, VERIFIER_USER_ID, 'VERIFIER');

      expect((mockTenantDb.evaluation as Record<string, jest.Mock>).update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workflowState: WorkflowState.VERIFIER_IN_PROGRESS,
            verifierUserId: VERIFIER_USER_ID,
          }),
        }),
      );
    });

    it('throws ConflictException (INVALID_STATE) when called from LOCKED state', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        makeBaseEvaluation({ workflowState: WorkflowState.LOCKED }),
      );

      await expect(
        svc.verifierStart(TENANT_ID, EVAL_ID, VERIFIER_USER_ID, 'VERIFIER'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when called from AI_IN_PROGRESS state', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        makeBaseEvaluation({ workflowState: WorkflowState.AI_IN_PROGRESS }),
      );

      await expect(
        svc.verifierStart(TENANT_ID, EVAL_ID, VERIFIER_USER_ID, 'VERIFIER'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when evaluation does not exist', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(null);

      await expect(
        svc.verifierStart(TENANT_ID, 'no-exist', VERIFIER_USER_ID, 'VERIFIER'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── verifierApprove ───────────────────────────────────────────────────────

  describe('verifierApprove', () => {
    const QA_LAYER = {
      answers: { resolved: { value: true } },
      sectionScores: { sec_q: 100 },
      overallScore: 85,
      passFail: true,
    };

    const IN_VERIFIER_EVAL = () =>
      makeBaseEvaluation({
        workflowState: WorkflowState.VERIFIER_IN_PROGRESS,
        verifierUserId: VERIFIER_USER_ID,
        qaScore: 85,
        qaAdjustedData: QA_LAYER,
      });

    it('transitions VERIFIER_IN_PROGRESS → LOCKED with finalScore from qaScore', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        IN_VERIFIER_EVAL(),
      );

      const result = await svc.verifierApprove(
        TENANT_ID,
        EVAL_ID,
        VERIFIER_USER_ID,
        'VERIFIER',
      );

      expect(result).toEqual({
        workflowState: WorkflowState.LOCKED,
        finalScore: 85,
        passFail: true,
      });
    });

    it('recomputes passFail from qaScore during approval when stored qa layer flag is stale', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        makeBaseEvaluation({
          workflowState: WorkflowState.VERIFIER_IN_PROGRESS,
          verifierUserId: VERIFIER_USER_ID,
          qaScore: 100,
          qaAdjustedData: {
            answers: { resolved: { value: true } },
            sectionScores: { sec_q: 100 },
            overallScore: 100,
            passFail: false,
          },
        }),
      );

      const result = await svc.verifierApprove(
        TENANT_ID,
        EVAL_ID,
        VERIFIER_USER_ID,
        'VERIFIER',
      );

      expect(result).toEqual({
        workflowState: WorkflowState.LOCKED,
        finalScore: 100,
        passFail: true,
      });
    });

    it('sets finalScore = null and passFail = false when qaScore is null', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        makeBaseEvaluation({
          workflowState: WorkflowState.VERIFIER_IN_PROGRESS,
          verifierUserId: VERIFIER_USER_ID,
          qaScore: null,
          qaAdjustedData: null,
        }),
      );

      const result = await svc.verifierApprove(
        TENANT_ID,
        EVAL_ID,
        VERIFIER_USER_ID,
        'VERIFIER',
      );

      expect(result).toMatchObject({ finalScore: null, passFail: false });
    });

    it('fires evaluation.completed webhook after approval', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        IN_VERIFIER_EVAL(),
      );

      await svc.verifierApprove(TENANT_ID, EVAL_ID, VERIFIER_USER_ID, 'VERIFIER');

      expect(mockWebhooks.deliver).toHaveBeenCalledWith(
        TENANT_ID,
        'evaluation.completed',
        expect.objectContaining({
          evaluationId: EVAL_ID,
          workflowState: WorkflowState.LOCKED,
          finalScore: 85,
          passFail: true,
        }),
      );
    });

    it('deletes the workflowQueue entry on approval', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        IN_VERIFIER_EVAL(),
      );

      await svc.verifierApprove(TENANT_ID, EVAL_ID, VERIFIER_USER_ID, 'VERIFIER');

      expect((mockTenantDb.workflowQueue as Record<string, jest.Mock>).deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { evaluationId: EVAL_ID } }),
      );
    });

    it('sets conversation status to COMPLETED on approval', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        IN_VERIFIER_EVAL(),
      );

      await svc.verifierApprove(TENANT_ID, EVAL_ID, VERIFIER_USER_ID, 'VERIFIER');

      expect((mockTenantDb.conversation as Record<string, jest.Mock>).update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CONV_ID },
          data: { status: 'COMPLETED' },
        }),
      );
    });

    it('throws ConflictException (INVALID_STATE) when not in VERIFIER_IN_PROGRESS state', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        makeBaseEvaluation({ workflowState: WorkflowState.QA_COMPLETED }),
      );

      await expect(
        svc.verifierApprove(TENANT_ID, EVAL_ID, VERIFIER_USER_ID, 'VERIFIER'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException (NOT_CLAIMED_BY_YOU) when a different user approves', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        makeBaseEvaluation({
          workflowState: WorkflowState.VERIFIER_IN_PROGRESS,
          verifierUserId: 'someone-else',
        }),
      );

      await expect(
        svc.verifierApprove(TENANT_ID, EVAL_ID, VERIFIER_USER_ID, 'VERIFIER'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when evaluation does not exist', async () => {
      (mockTenantDb.evaluation as Record<string, jest.Mock>).findUnique.mockResolvedValue(null);

      await expect(
        svc.verifierApprove(TENANT_ID, 'no-exist', VERIFIER_USER_ID, 'VERIFIER'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
