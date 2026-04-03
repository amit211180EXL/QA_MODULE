import { api } from '@/lib/api-client';

export interface EvaluationDetail {
  id: string;
  conversationId: string;
  workflowState: string;
  aiScore: number | null;
  qaScore: number | null;
  verifierScore: number | null;
  finalScore: number | null;
  passFail: boolean | null;
  qaUserId: string | null;
  verifierUserId: string | null;
  verifierRejectReason: string | null;
  qaCompletedAt: string | null;
  verifierCompletedAt: string | null;
  aiResponseData: ResponseLayer | null;
  qaAdjustedData: ResponseLayer | null;
  verifierFinalData: ResponseLayer | null;
  formDefinition: {
    id: string;
    formKey: string;
    version: number;
    name: string;
    sections: FormSection[];
    questions: FormQuestion[];
    scoringStrategy: { passMark: number; scale: number };
  };
  conversation: {
    id: string;
    channel: string;
    agentName: string | null;
    customerRef: string | null;
    content: unknown;
    metadata: unknown | null;
    receivedAt: string;
    externalId: string | null;
  };
  deviationRecords: DeviationRecord[];
}

export interface ResponseLayer {
  answers: Record<string, AnswerRecord>;
  sectionScores: Record<string, number>;
  overallScore: number;
  passFail: boolean;
}

export interface AnswerRecord {
  value: unknown;
  reasoning?: string;
  confidence?: number;
  overrideReason?: string;
}

export interface FormSection {
  id: string;
  title: string;
  weight: number;
  order: number;
}

export interface FormQuestion {
  id: string;
  sectionId: string;
  key: string;
  label: string;
  type: 'rating' | 'boolean' | 'text' | 'select' | 'multiselect';
  required: boolean;
  weight: number;
  order: number;
  rubric?: { goal: string; anchors: Array<{ value: number; label: string }> };
  options?: Array<{ value: string; label: string }>;
  validation?: { min?: number; max?: number };
  conditionalLogic?: {
    showIf: {
      questionKey: string;
      operator: 'eq' | 'neq' | 'gt' | 'lt';
      value: unknown;
    };
  };
}

export interface DeviationRecord {
  id: string;
  type: string;
  scoreA: number;
  scoreB: number;
  deviation: number;
}

export const evaluationsApi = {
  get: (id: string) =>
    api.get<{ data: EvaluationDetail }>(`/evaluations/${id}`).then((r) => r.data.data),

  qaStart: (id: string) => api.post(`/evaluations/${id}/qa-start`).then((r) => r.data),

  qaSubmit: (
    id: string,
    payload: {
      adjustedAnswers: Record<string, { value: unknown; overrideReason?: string }>;
      feedback?: string;
      flags?: string[];
    },
  ) => api.post(`/evaluations/${id}/qa-submit`, payload).then((r) => r.data),

  verifierStart: (id: string) => api.post(`/evaluations/${id}/verifier-start`).then((r) => r.data),

  verifierApprove: (id: string) =>
    api.post(`/evaluations/${id}/verifier-approve`).then((r) => r.data),

  verifierModify: (
    id: string,
    payload: {
      modifiedAnswers: Record<string, { value: unknown; overrideReason: string }>;
      feedback?: string;
    },
  ) => api.post(`/evaluations/${id}/verifier-modify`, payload).then((r) => r.data),

  verifierReject: (id: string, reason: string) =>
    api.post(`/evaluations/${id}/verifier-reject`, { reason }).then((r) => r.data),

  listQaQueue: (page = 1, limit = 20, search?: string) =>
    api
      .get<{
        items: QueueItem[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>('/evaluations/queue/qa', { params: { page, limit, search } })
      .then((r) => r.data),

  listVerifierQueue: (page = 1, limit = 20, search?: string) =>
    api
      .get<{
        items: QueueItem[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>('/evaluations/queue/verifier', { params: { page, limit, search } })
      .then((r) => r.data),

  listEscalationQueue: (page = 1, limit = 20, search?: string) =>
    api
      .get<{
        items: EscalationQueueItem[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>('/evaluations/queue/escalation', { params: { page, limit, search } })
      .then((r) => r.data),

  listAuditQueue: (page = 1, limit = 20, search?: string) =>
    api
      .get<{
        items: AuditQueueItem[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>('/evaluations/queue/audit', { params: { page, limit, search } })
      .then((r) => r.data),

  resolveAuditCase: (id: string, payload: { dismiss?: boolean; note?: string }) =>
    api.patch(`/evaluations/audit-cases/${id}/resolve`, payload).then((r) => r.data),

  getAuditLog: (id: string) =>
    api.get<{ data: AuditLogEntry[] }>(`/evaluations/${id}/audit`).then((r) => r.data.data),

  // ─── Assignment ──────────────────────────────────────────────────────────────

  manualAssign: (evaluationId: string, userId: string) =>
    api
      .post<{ data: AssignmentResult }>('/evaluations/assign', { evaluationId, userId })
      .then((r) => r.data),

  roundRobinAssign: (queueType: string, limit?: number) =>
    api
      .post<{ data: RoundRobinResult }>('/evaluations/assign/round-robin', { queueType, limit })
      .then((r) => r.data),

  reassign: (evaluationId: string, newUserId: string, reason?: string) =>
    api
      .post<{ data: ReassignResult }>('/evaluations/reassign', { evaluationId, newUserId, reason })
      .then((r) => r.data),
};

// ─── Queue item shapes (workflowQueue rows with nested evaluation) ────────────

export interface QueueItem {
  id: string;
  evaluationId: string;
  queueType: string;
  priority: number;
  assignedTo: string | null;
  dueBy: string | null;
  createdAt: string;
  updatedAt: string;
  evaluation: {
    id: string;
    workflowState: string;
    aiScore: number | null;
    qaScore: number | null;
    verifierRejectReason: string | null;
    verifierRejectedAt: string | null;
    formDefinitionId: string;
    formVersion: number;
    conversation: {
      id: string;
      channel: string;
      agentName: string | null;
      customerRef: string | null;
      externalId: string | null;
      receivedAt: string;
    };
  };
}

export interface EscalationQueueItem {
  id: string;
  queueType: string;
  priority: number;
  status: string;
  createdAt: string;
  evaluation: {
    id: string;
    workflowState: string;
    aiScore: number | null;
    qaScore: number | null;
    isEscalated: boolean;
    escalationReason: string | null;
    conversation: {
      channel: string;
      agentName: string | null;
      externalId: string | null;
      receivedAt: string;
    };
  };
}

export interface AuditLogEntry {
  id: string;
  action: string;
  actorId: string;
  actorRole: string;
  before: unknown;
  after: unknown;
  metadata: unknown;
  createdAt: string;
}

export interface AuditQueueItem {
  id: string;
  queueType: string;
  priority: number;
  createdAt: string;
  evaluation: {
    id: string;
    workflowState: string;
    qaScore: number | null;
    verifierScore: number | null;
    finalScore: number | null;
    conversation: {
      id: string;
      channel: string;
      agentName: string | null;
      customerRef: string | null;
      externalId: string | null;
      receivedAt: string;
    };
    auditCase: {
      id: string;
      status: 'OPEN' | 'RESOLVED' | 'DISMISSED';
      deviation: number;
      threshold: number;
      reason: string;
      resolutionNote: string | null;
      resolvedBy: string | null;
      resolvedAt: string | null;
      createdAt: string;
    } | null;
  };
}

// ─── Assignment types ───────────────────────────────────────────────────────────

export interface AssignmentResult {
  evaluationId: string;
  assignedTo: string;
  assignedToName: string;
  assignmentType: 'qa' | 'verifier';
}

export interface RoundRobinResult {
  assigned: number;
  distribution: Array<{ userId: string; name: string; count: number }>;
  message?: string;
}

export interface ReassignResult {
  evaluationId: string;
  previousUserId: string | null;
  newUserId: string;
  newUserName: string;
  assignmentType: 'qa' | 'verifier';
}
