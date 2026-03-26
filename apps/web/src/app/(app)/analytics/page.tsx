'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Topbar } from '@/components/layout/topbar';
import {
  analyticsApi,
  type OverviewKpis,
  type AgentPerformanceRow,
  type DeviationTrendPoint,
} from '@/lib/analytics-api';

function fmt(n: number | null | undefined, decimals = 0, suffix = ''): string {
  if (n == null) return '—';
  return n.toFixed(decimals) + suffix;
}

function DateRange({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <label className="text-gray-500">From</label>
      <input
        type="date"
        value={from}
        onChange={(e) => onChange(e.target.value, to)}
        className="rounded-lg border border-gray-300 px-2 py-1 text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
      <label className="text-gray-500">To</label>
      <input
        type="date"
        value={to}
        onChange={(e) => onChange(from, e.target.value)}
        className="rounded-lg border border-gray-300 px-2 py-1 text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
    </div>
  );
}

export default function AnalyticsPage() {
  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 3600_000);

  const [fromDate, setFromDate] = useState(thirtyDaysAgo.toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(today.toISOString().slice(0, 10));

  const from = new Date(fromDate);
  const to = new Date(toDate);

  const { data: kpis, isLoading: kpisLoading } = useQuery<OverviewKpis>({
    queryKey: ['analytics', 'overview', fromDate, toDate],
    queryFn: () => analyticsApi.overview(from, to),
    staleTime: 60_000,
  });

  const { data: agents, isLoading: agentsLoading } = useQuery<AgentPerformanceRow[]>({
    queryKey: ['analytics', 'agents', fromDate, toDate],
    queryFn: () => analyticsApi.agentPerformance(from, to),
    staleTime: 60_000,
  });

  const { data: trends } = useQuery<DeviationTrendPoint[]>({
    queryKey: ['analytics', 'trends', fromDate, toDate],
    queryFn: () => analyticsApi.deviationTrends(from, to),
    staleTime: 60_000,
  });

  const kpiCards = [
    { label: 'Total Conversations', value: fmt(kpis?.totalConversations) },
    { label: 'Completed Evaluations', value: fmt(kpis?.completedEvaluations) },
    { label: 'Pending QA', value: fmt(kpis?.pendingQA) },
    { label: 'Pending Verifier', value: fmt(kpis?.pendingVerifier) },
    { label: 'Avg Final Score', value: fmt(kpis?.avgFinalScore, 1) },
    { label: 'Pass Rate', value: fmt(kpis?.passRate, 1, '%') },
    { label: 'AI ↔ QA Deviation', value: fmt(kpis?.avgAiQaDeviation, 2) },
  ];

  return (
    <>
      <Topbar title="Analytics" />
      <div className="p-6 space-y-8">
        {/* Date range picker */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">Performance Overview</h2>
          <DateRange
            from={fromDate}
            to={toDate}
            onChange={(f, t) => {
              setFromDate(f);
              setToDate(t);
            }}
          />
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {kpiCards.map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <p className="text-xs text-gray-500">{card.label}</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {kpisLoading ? (
                  <span className="inline-block h-6 w-12 animate-pulse rounded bg-gray-200" />
                ) : (
                  card.value
                )}
              </p>
            </div>
          ))}
        </div>

        {/* Deviation trends mini-table */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-4">
            <h3 className="font-semibold text-gray-800">Deviation Trends (by day)</h3>
          </div>
          {!trends || trends.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">
              No deviation data for this period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Date</th>
                    <th className="px-5 py-3 text-right font-medium">AI ↔ QA Deviation</th>
                    <th className="px-5 py-3 text-right font-medium">QA ↔ Verifier Deviation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {trends.map((row) => (
                    <tr key={row.date} className="hover:bg-gray-50">
                      <td className="px-5 py-3 text-gray-700">
                        {new Date(row.date).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-gray-700">
                        {row.avgAiQaDeviation.toFixed(2)}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-gray-700">
                        {row.avgQaVerifierDeviation.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Agent performance table */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-4">
            <h3 className="font-semibold text-gray-800">Agent Performance</h3>
          </div>
          {agentsLoading ? (
            <div className="px-5 py-6 text-center text-sm text-gray-400">Loading…</div>
          ) : !agents || agents.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">
              No evaluations completed in this period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Agent</th>
                    <th className="px-5 py-3 text-right font-medium">Evaluations</th>
                    <th className="px-5 py-3 text-right font-medium">Avg Score</th>
                    <th className="px-5 py-3 text-right font-medium">Pass Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {agents.map((row) => (
                    <tr key={row.agentId} className="hover:bg-gray-50">
                      <td className="px-5 py-3 font-medium text-gray-800">{row.agentName}</td>
                      <td className="px-5 py-3 text-right text-gray-700">{row.totalEvaluations}</td>
                      <td className="px-5 py-3 text-right font-mono text-gray-700">
                        {row.avgScore.toFixed(1)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            row.passRate >= 80
                              ? 'bg-green-100 text-green-700'
                              : row.passRate >= 60
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {row.passRate.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
