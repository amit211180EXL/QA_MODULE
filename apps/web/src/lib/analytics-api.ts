import { api } from './api-client';

export interface OverviewKpis {
  totalConversations: number;
  completedEvaluations: number;
  pendingQA: number;
  pendingVerifier: number;
  avgFinalScore: number | null;
  passRate: number | null;
  avgAiQaDeviation: number | null;
}

export interface AgentPerformanceRow {
  agentId: string;
  agentName: string;
  totalEvaluations: number;
  avgScore: number;
  passRate: number;
}

export interface DeviationTrendPoint {
  date: string;
  avgAiQaDeviation: number;
  avgQaVerifierDeviation: number;
}

export interface QuestionDeviationRow {
  questionKey: string;
  sectionId: string | null;
  overrideCount: number;
  overrideRate: number;
}

export interface EscalationStats {
  escalated: number;
  pendingEscalation: number;
}

export interface VerifierOverrideRow {
  questionKey: string;
  sectionId: string | null;
  overrideCount: number;
  overrideRate: number;
}

export interface RejectionReasonRow {
  reason: string;
  count: number;
  rate: number;
}

export interface ScoreTrendDay {
  date: string;
  avgScore: number | null;
  count: number;
  passRate: number;
}

export interface ScoreTrendChannel {
  channel: string;
  avgScore: number | null;
  count: number;
  passRate: number;
}

export interface AiUsageTrendPoint {
  period: string;
  periodStart: string;
  periodEnd: string;
  conversationsProcessed: number;
  aiTokensUsed: number;
  aiCostCents: number;
  aiCostDollars: number;
  activeUsers: number;
}

export const analyticsApi = {
  overview: (from?: Date, to?: Date) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from.toISOString());
    if (to) params.set('to', to.toISOString());
    return api.get<OverviewKpis>(`/analytics/overview?${params}`).then((r) => r.data);
  },

  agentPerformance: (from?: Date, to?: Date) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from.toISOString());
    if (to) params.set('to', to.toISOString());
    return api
      .get<AgentPerformanceRow[]>(`/analytics/agent-performance?${params}`)
      .then((r) => r.data);
  },

  deviationTrends: (from?: Date, to?: Date) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from.toISOString());
    if (to) params.set('to', to.toISOString());
    return api
      .get<DeviationTrendPoint[]>(`/analytics/deviation-trends?${params}`)
      .then((r) => r.data);
  },

  questionDeviations: (from?: Date, to?: Date) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from.toISOString());
    if (to) params.set('to', to.toISOString());
    return api
      .get<QuestionDeviationRow[]>(`/analytics/question-deviations?${params}`)
      .then((r) => r.data);
  },

  escalationStats: (from?: Date, to?: Date) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from.toISOString());
    if (to) params.set('to', to.toISOString());
    return api.get<EscalationStats>(`/analytics/escalation-stats?${params}`).then((r) => r.data);
  },

  verifierOverrides: (from?: Date, to?: Date) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from.toISOString());
    if (to) params.set('to', to.toISOString());
    return api
      .get<VerifierOverrideRow[]>(`/analytics/verifier-overrides?${params}`)
      .then((r) => r.data);
  },

  rejectionReasons: (from?: Date, to?: Date) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from.toISOString());
    if (to) params.set('to', to.toISOString());
    return api
      .get<RejectionReasonRow[]>(`/analytics/rejection-reasons?${params}`)
      .then((r) => r.data);
  },

  scoreTrends: (from?: Date, to?: Date) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from.toISOString());
    if (to) params.set('to', to.toISOString());
    return api
      .get<{
        byDay: ScoreTrendDay[];
        byChannel: ScoreTrendChannel[];
      }>(`/analytics/score-trends?${params}`)
      .then((r) => r.data);
  },

  aiUsageTrends: (from?: Date, to?: Date) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from.toISOString());
    if (to) params.set('to', to.toISOString());
    return api.get<AiUsageTrendPoint[]>(`/analytics/ai-usage-trends?${params}`).then((r) => r.data);
  },
};
