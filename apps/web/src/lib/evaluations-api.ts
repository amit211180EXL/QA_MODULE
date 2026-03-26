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

  listQaQueue: (page = 1, limit = 20) =>
    api
      .get<{
        items: EvaluationDetail[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>(`/evaluations/queue/qa?page=${page}&limit=${limit}`)
      .then((r) => r.data),

  listVerifierQueue: (page = 1, limit = 20) =>
    api
      .get<{
        items: EvaluationDetail[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>(`/evaluations/queue/verifier?page=${page}&limit=${limit}`)
      .then((r) => r.data),
};
