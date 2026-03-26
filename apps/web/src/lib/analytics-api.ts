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

export const analyticsApi = {
  overview: (from?: Date, to?: Date) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from.toISOString());
    if (to) params.set('to', to.toISOString());
    return api.get<OverviewKpis>(`/api/v1/analytics/overview?${params}`).then((r) => r.data);
  },

  agentPerformance: (from?: Date, to?: Date) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from.toISOString());
    if (to) params.set('to', to.toISOString());
    return api
      .get<AgentPerformanceRow[]>(`/api/v1/analytics/agent-performance?${params}`)
      .then((r) => r.data);
  },

  deviationTrends: (from?: Date, to?: Date) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from.toISOString());
    if (to) params.set('to', to.toISOString());
    return api
      .get<DeviationTrendPoint[]>(`/api/v1/analytics/deviation-trends?${params}`)
      .then((r) => r.data);
  },
};
