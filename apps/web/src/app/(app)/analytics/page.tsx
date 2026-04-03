'use client';

import React, { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Topbar } from '@/components/layout/topbar';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  analyticsApi,
  type OverviewKpis,
  type AgentPerformanceRow,
  type DeviationTrendPoint,
  type QuestionDeviationRow,
  type VerifierOverrideRow,
  type RejectionReasonRow,
  type ScoreTrendDay,
  type ScoreTrendChannel,
  type AiUsageTrendPoint,
} from '@/lib/analytics-api';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Download, BarChart3, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

type ExportQuestionRow = Pick<QuestionDeviationRow, 'questionKey' | 'overrideCount' | 'overrideRate'>;
type ExportReasonRow = Pick<RejectionReasonRow, 'reason' | 'count' | 'rate'>;

function fmt(n: number | null | undefined, decimals = 0, suffix = ''): string {
  if (n == null) return '—';
  return n.toFixed(decimals) + suffix;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function EmptyChart({ label }: { label: string }) {
  return <div className="flex h-48 items-center justify-center text-sm text-slate-400">{label}</div>;
}

function downloadCSV(rows: AgentPerformanceRow[], kpis: OverviewKpis | undefined, fromDate: string, toDate: string) {
  const lines: string[] = [];

  // KPI summary block
  lines.push('Summary');
  lines.push(`Period,${fromDate} — ${toDate}`);
  lines.push(`Total Conversations,${kpis?.totalConversations ?? ''}`);
  lines.push(`Completed Evaluations,${kpis?.completedEvaluations ?? ''}`);
  lines.push(`Pending QA,${kpis?.pendingQA ?? ''}`);
  lines.push(`Pending Verifier,${kpis?.pendingVerifier ?? ''}`);
  lines.push(`Avg Final Score,${kpis?.avgFinalScore?.toFixed(2) ?? ''}`);
  lines.push(`Pass Rate,${kpis?.passRate?.toFixed(2) ?? ''}`);
  lines.push(`AI <-> QA Deviation,${kpis?.avgAiQaDeviation?.toFixed(2) ?? ''}`);
  lines.push('');

  // Agent performance block
  lines.push('Agent Performance');
  lines.push('Agent,Evaluations,Avg Score,Pass Rate (%)');
  for (const r of rows) {
    const name = `"${r.agentName.replace(/"/g, '""')}"`;
    lines.push(`${name},${r.totalEvaluations},${r.avgScore.toFixed(2)},${r.passRate.toFixed(2)}`);
  }

  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `qa-analytics-${fromDate}-${toDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadPDF({
  kpis,
  agents,
  questionDevs,
  rejectionReasons,
  fromDate,
  toDate,
}: {
  kpis: OverviewKpis | undefined;
  agents: AgentPerformanceRow[];
  questionDevs: ExportQuestionRow[];
  rejectionReasons: ExportReasonRow[];
  fromDate: string;
  toDate: string;
}) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text('QA Analytics Report', 14, 16);
  doc.setFontSize(10);
  doc.text(`Period: ${fromDate} to ${toDate}`, 14, 22);

  autoTable(doc, {
    startY: 28,
    head: [['Metric', 'Value']],
    body: [
      ['Total Conversations', String(kpis?.totalConversations ?? '—')],
      ['Completed Evaluations', String(kpis?.completedEvaluations ?? '—')],
      ['Pending QA', String(kpis?.pendingQA ?? '—')],
      ['Pending Verifier', String(kpis?.pendingVerifier ?? '—')],
      ['Avg Final Score', kpis?.avgFinalScore != null ? kpis.avgFinalScore.toFixed(2) : '—'],
      ['Pass Rate', kpis?.passRate != null ? `${kpis.passRate.toFixed(2)}%` : '—'],
      ['AI <-> QA Deviation', kpis?.avgAiQaDeviation != null ? kpis.avgAiQaDeviation.toFixed(2) : '—'],
    ],
    theme: 'grid',
    headStyles: { fillColor: [55, 65, 81] },
  });

  autoTable(doc, {
    head: [['Agent', 'Evaluations', 'Avg Score', 'Pass Rate']],
    body:
      agents.length > 0
        ? agents.map((row) => [
            row.agentName,
            String(row.totalEvaluations),
            row.avgScore.toFixed(2),
            `${row.passRate.toFixed(2)}%`,
          ])
        : [['No data', '-', '-', '-']],
    theme: 'striped',
    headStyles: { fillColor: [79, 70, 229] },
  });

  autoTable(doc, {
    head: [['Question Key', 'Overrides', 'Override Rate']],
    body:
      questionDevs.length > 0
        ? questionDevs.slice(0, 10).map((row) => [
            row.questionKey,
            String(row.overrideCount),
            `${row.overrideRate.toFixed(2)}%`,
          ])
        : [['No data', '-', '-']],
    theme: 'striped',
    headStyles: { fillColor: [245, 158, 11] },
  });

  autoTable(doc, {
    head: [['Rejection Reason', 'Count', 'Rate']],
    body:
      rejectionReasons.length > 0
        ? rejectionReasons.slice(0, 10).map((row) => [row.reason, String(row.count), `${row.rate.toFixed(2)}%`])
        : [['No data', '-', '-']],
    theme: 'striped',
    headStyles: { fillColor: [5, 150, 105] },
  });

  doc.save(`qa-analytics-${fromDate}-${toDate}.pdf`);
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
    <div className="flex items-center gap-3 text-sm">
      <label className="font-medium text-slate-600">From</label>
      <input
        type="date"
        value={from}
        onChange={(e) => onChange(e.target.value, to)}
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all duration-base"
      />
      <label className="font-medium text-slate-600">To</label>
      <input
        type="date"
        value={to}
        onChange={(e) => onChange(from, e.target.value)}
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all duration-base"
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

  const { data: kpis, isLoading: kpisLoading, isFetching: kpisFetching } = useQuery<OverviewKpis>({
    queryKey: ['analytics', 'overview', fromDate, toDate],
    queryFn: () => analyticsApi.overview(from, to),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const { data: agents, isLoading: agentsLoading, isFetching: agentsFetching } = useQuery<AgentPerformanceRow[]>({
    queryKey: ['analytics', 'agents', fromDate, toDate],
    queryFn: () => analyticsApi.agentPerformance(from, to),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const { data: trends, isLoading: trendsLoading, isFetching: trendsFetching } = useQuery<DeviationTrendPoint[]>({
    queryKey: ['analytics', 'trends', fromDate, toDate],
    queryFn: () => analyticsApi.deviationTrends(from, to),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const { data: questionDevs, isLoading: questionDevsLoading, isFetching: questionDevsFetching } = useQuery<QuestionDeviationRow[]>({
    queryKey: ['analytics', 'question-deviations', fromDate, toDate],
    queryFn: () => analyticsApi.questionDeviations(from, to),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const { data: verifierOverrides, isLoading: verifierOverridesLoading, isFetching: verifierOverridesFetching } = useQuery<VerifierOverrideRow[]>({
    queryKey: ['analytics', 'verifier-overrides', fromDate, toDate],
    queryFn: () => analyticsApi.verifierOverrides(from, to),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const { data: rejectionReasons, isLoading: rejectionReasonsLoading, isFetching: rejectionReasonsFetching } = useQuery<RejectionReasonRow[]>({
    queryKey: ['analytics', 'rejection-reasons', fromDate, toDate],
    queryFn: () => analyticsApi.rejectionReasons(from, to),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const { data: scoreTrends } = useQuery<{ byDay: ScoreTrendDay[]; byChannel: ScoreTrendChannel[] }>({
    queryKey: ['analytics', 'score-trends', fromDate, toDate],
    queryFn: () => analyticsApi.scoreTrends(from, to),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const { data: aiUsage } = useQuery<AiUsageTrendPoint[]>({
    queryKey: ['analytics', 'ai-usage', fromDate, toDate],
    queryFn: () => analyticsApi.aiUsageTrends(from, to),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const isRefreshing =
    kpisFetching ||
    agentsFetching ||
    trendsFetching ||
    questionDevsFetching ||
    verifierOverridesFetching ||
    rejectionReasonsFetching;

  const kpiCards = [
    { label: 'Total Conversations', value: fmt(kpis?.totalConversations) },
    { label: 'Completed Evaluations', value: fmt(kpis?.completedEvaluations) },
    { label: 'Pending QA', value: fmt(kpis?.pendingQA) },
    { label: 'Pending Verifier', value: fmt(kpis?.pendingVerifier) },
    { label: 'Avg Final Score', value: fmt(kpis?.avgFinalScore, 1) },
    { label: 'Pass Rate', value: fmt(kpis?.passRate, 1, '%') },
    { label: 'AI ↔ QA Deviation', value: fmt(kpis?.avgAiQaDeviation, 2) },
  ];

  const agentChartData =
    agents?.map((a) => ({
      name: a.agentName.split(' ')[0],
      fullName: a.agentName,
      avgScore: Number(a.avgScore.toFixed(1)),
      passRate: Number(a.passRate.toFixed(1)),
      total: a.totalEvaluations,
    })) ?? [];

  const trendChartData =
    trends?.map((t) => ({
      date: shortDate(t.date),
      'AI↔QA': Number(t.avgAiQaDeviation.toFixed(2)),
      'QA↔Verifier': Number(t.avgQaVerifierDeviation.toFixed(2)),
    })) ?? [];

  return (
    <>
      <Topbar title="Analytics" />
      <div className="space-y-6">
        {/* Page header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 text-2xs font-bold uppercase tracking-[0.2em] text-primary-600/90">
              <Sparkles className="h-3.5 w-3.5 text-primary-500" aria-hidden />
              Insights
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
              <span className="text-gradient-brand">Analytics</span>
            </h1>
            <p className="mt-2 max-w-xl text-base text-slate-600">
              Performance, drift, and overrides — export-ready when leadership asks.
            </p>
          </div>
          <div className="surface-glass hidden rounded-xl border-slate-200/60 px-4 py-2 text-sm font-semibold text-slate-600 md:flex md:items-center md:gap-2">
            <BarChart3 className="h-4 w-4 text-primary-500" aria-hidden />
            Recharts + CSV / PDF
          </div>
        </div>

        {/* Date range filter card */}
        <Card shadow="sm">
          <CardHeader withGradient>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Date Range</h2>
                <p className="text-sm text-slate-600">Select the period to analyze</p>
              </div>
              <DateRange
                from={fromDate}
                to={toDate}
                onChange={(f, t) => {
                  setFromDate(f);
                  setToDate(t);
                }}
              />
            </div>
          </CardHeader>
        </Card>

        {isRefreshing && (
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-4 py-2 text-xs font-medium text-slate-500">
            Updating analytics...
          </div>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpiCards.map((card) => (
            <Card
              key={card.label}
              shadow="xs"
              className="group relative overflow-hidden border-slate-200/90 bg-white/90 backdrop-blur-sm transition-all duration-base ease-smooth hover:-translate-y-0.5 hover:border-primary-200/70 hover:shadow-lg hover:shadow-primary-500/[0.06]"
            >
              <div
                aria-hidden
                className="absolute inset-x-0 top-0 h-0.5 scale-x-0 bg-gradient-to-r from-primary-500 via-accent-500 to-primary-600 opacity-0 transition-all duration-base group-hover:scale-x-100 group-hover:opacity-100"
              />
              <CardBody className="relative">
                <p className="text-2xs font-bold uppercase tracking-wide text-slate-500">
                  {card.label}
                </p>
                <p className="mt-3 text-3xl font-bold tabular-nums tracking-tight text-slate-900">
                  {kpisLoading ? (
                    <span className="inline-block h-8 w-16 animate-pulse rounded-md bg-slate-200" />
                  ) : (
                    card.value
                  )}
                </p>
              </CardBody>
            </Card>
          ))}
        </div>

        {/* Charts row - Deviation Trends and Agent Pass Rate */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Deviation trends line chart */}
          <Card shadow="sm">
            <CardHeader>
              <h3 className="text-lg font-semibold text-slate-900">Deviation Trends</h3>
              <p className="mt-1 text-sm text-slate-600">AI↔QA and QA↔Verifier per day</p>
            </CardHeader>
            <CardBody>
              {trendsLoading ? (
                <div className="flex h-48 items-center justify-center">
                  <span className="animate-pulse text-sm text-slate-400">Loading…</span>
                </div>
              ) : trendChartData.length === 0 ? (
                <EmptyChart label="No deviation data for this period." />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart
                    data={trendChartData}
                    margin={{ top: 4, right: 16, left: -8, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={(value: any) => [
                        typeof value === 'number' ? value.toFixed(2) : String(value ?? ''),
                        '',
                      ]}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="AI↔QA"
                      stroke="#818cf8"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="QA↔Verifier"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardBody>
          </Card>

          {/* Agent pass rate bar chart */}
          <Card shadow="sm">
            <CardHeader>
              <h3 className="text-lg font-semibold text-slate-900">Agent Pass Rate</h3>
              <p className="mt-1 text-sm text-slate-600">% of evaluations that passed</p>
            </CardHeader>
            <CardBody>
              {agentsLoading ? (
                <div className="flex h-48 items-center justify-center">
                  <span className="animate-pulse text-sm text-slate-400">Loading…</span>
                </div>
              ) : agentChartData.length === 0 ? (
                <EmptyChart label="No agent data for this period." />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={agentChartData}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: -8, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={64} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={(
                        value: any,
                        _name: any,
                        props: { payload?: { fullName?: string; total?: number } },
                      ) => [
                        `${value ?? 0}% (${props.payload?.total ?? 0} evals)`,
                        props.payload?.fullName ?? '',
                      ]}
                    />
                    <Bar dataKey="passRate" radius={[0, 4, 4, 0]}>
                      {agentChartData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={
                            entry.passRate >= 80
                              ? '#22c55e'
                              : entry.passRate >= 60
                                ? '#f59e0b'
                                : '#ef4444'
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Agent Performance and Question Analysis Tables */}
        <Card shadow="sm">
          <CardHeader>
            <h3 className="text-lg font-semibold text-slate-900">Top Verifier Overrides by Question</h3>
            <p className="mt-1 text-sm text-slate-600">
              Questions where verifiers most often changed the QA answer (QA → Verifier deviance)
            </p>
          </CardHeader>
          <CardBody>
            {verifierOverridesLoading ? (
              <div className="text-center text-sm text-slate-400">Loading…</div>
            ) : !verifierOverrides || verifierOverrides.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">
                No verifier overrides recorded in this period.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                        Question key
                      </th>
                      <th className="px-5 py-3 text-right text-2xs font-semibold uppercase tracking-wide text-slate-500">
                        Override count
                      </th>
                      <th className="px-5 py-3 text-right text-2xs font-semibold uppercase tracking-wide text-slate-500">
                        Override rate
                      </th>
                      <th className="px-5 py-3 text-right text-2xs font-semibold uppercase tracking-wide text-slate-500">
                        Impact
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {verifierOverrides.map((row) => (
                      <tr key={row.questionKey} className="hover:bg-slate-50">
                        <td className="px-5 py-3 font-mono text-xs text-slate-800">
                          {row.questionKey}
                        </td>
                        <td className="px-5 py-3 text-right text-slate-700">{row.overrideCount}</td>
                        <td className="px-5 py-3 text-right font-mono text-slate-700">
                          {row.overrideRate.toFixed(1)}%
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex h-2 w-20 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={`h-2 rounded-full ${
                                row.overrideRate >= 50
                                  ? 'bg-danger-500'
                                  : row.overrideRate >= 25
                                    ? 'bg-warning-500'
                                    : 'bg-accent-400'
                              }`}
                              style={{ width: `${Math.min(100, row.overrideRate * 2)}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Rejection Reasons */}
        <Card shadow="sm">
          <CardHeader>
            <h3 className="text-lg font-semibold text-slate-900">Common Rejection Reasons</h3>
            <p className="mt-1 text-sm text-slate-600">
              Most frequent reasons verifiers rejected QA submissions
            </p>
          </CardHeader>
          <CardBody>
            {rejectionReasonsLoading ? (
              <div className="text-center text-sm text-slate-400">Loading…</div>
            ) : !rejectionReasons || rejectionReasons.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">
                No rejections recorded in this period.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                        Reason
                      </th>
                      <th className="px-5 py-3 text-right text-2xs font-semibold uppercase tracking-wide text-slate-500">
                        Count
                      </th>
                      <th className="px-5 py-3 text-right text-2xs font-semibold uppercase tracking-wide text-slate-500">
                        % of rejections
                      </th>
                      <th className="px-5 py-3 text-right text-2xs font-semibold uppercase tracking-wide text-slate-500">
                        Frequency
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rejectionReasons.map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-5 py-3 text-slate-800 max-w-[320px]">{row.reason}</td>
                        <td className="px-5 py-3 text-right text-slate-700">{row.count}</td>
                        <td className="px-5 py-3 text-right font-mono text-slate-700">
                          {row.rate.toFixed(1)}%
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-2 rounded-full bg-warning-500"
                              style={{ width: `${Math.min(100, row.rate)}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Score trends */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2" shadow="sm">
            <CardHeader>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Daily Avg Score &amp; Pass Rate</h3>
                <p className="mt-1 text-sm text-slate-600">Locked evaluations over the period</p>
              </div>
            </CardHeader>
            <CardBody>
              {!scoreTrends || scoreTrends.byDay.length === 0 ? (
                <EmptyChart label="No locked evaluations in this period" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={scoreTrends.byDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d) => shortDate(d)}
                      tick={{ fontSize: 11 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis yAxisId="score" domain={[0, 100]} tick={{ fontSize: 11 }} width={32} />
                    <YAxis
                      yAxisId="rate"
                      orientation="right"
                      domain={[0, 100]}
                      tick={{ fontSize: 11 }}
                      width={36}
                      unit="%"
                    />
                    <Tooltip
                      formatter={(value, name) =>
                        name === 'Pass Rate'
                          ? [`${(value as number).toFixed(1)}%`, name]
                          : [(value as number).toFixed(1), name]
                      }
                    />
                    <Legend />
                    <Line
                      yAxisId="score"
                      type="monotone"
                      dataKey="avgScore"
                      name="Avg Score"
                      stroke="#6366f1"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      yAxisId="rate"
                      type="monotone"
                      dataKey="passRate"
                      name="Pass Rate"
                      stroke="#22c55e"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardBody>
          </Card>

          <Card shadow="sm">
            <CardHeader>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Score by Channel</h3>
                <p className="mt-1 text-sm text-slate-600">Avg final score per channel</p>
              </div>
            </CardHeader>
            <CardBody>
              {!scoreTrends || scoreTrends.byChannel.length === 0 ? (
                <EmptyChart label="No data" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={scoreTrends.byChannel} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="channel" tick={{ fontSize: 11 }} width={55} />
                    <Tooltip formatter={(v) => (v as number).toFixed(1)} />
                    <Bar dataKey="avgScore" name="Avg Score" radius={[0, 4, 4, 0]}>
                      {scoreTrends.byChannel.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={
                            (entry.avgScore ?? 0) >= 80
                              ? '#22c55e'
                              : (entry.avgScore ?? 0) >= 60
                                ? '#f59e0b'
                                : '#ef4444'
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardBody>
          </Card>
        </div>

        {/* AI usage trends */}
        <Card shadow="sm">
          <CardHeader>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">AI Usage &amp; Cost Trends</h3>
              <p className="mt-1 text-sm text-slate-600">Monthly token consumption and cost</p>
            </div>
          </CardHeader>
          <CardBody>
            {!aiUsage || aiUsage.length === 0 ? (
              <EmptyChart label="No AI usage data for this period" />
            ) : (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div>
                  <p className="mb-4 text-2xs font-semibold uppercase tracking-wide text-slate-500">
                    Tokens used / month
                  </p>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={aiUsage}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        width={50}
                        tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
                      />
                      <Tooltip formatter={(v) => (v as number).toLocaleString()} />
                      <Bar dataKey="aiTokensUsed" name="Tokens" fill="#818cf8" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <p className="mb-4 text-2xs font-semibold uppercase tracking-wide text-slate-500">
                    Cost (USD) / month
                  </p>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={aiUsage}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        width={50}
                        tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                      />
                      <Tooltip formatter={(v) => `$${(v as number).toFixed(2)}`} />
                      <Bar dataKey="aiCostDollars" name="Cost" fill="#34d399" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}






