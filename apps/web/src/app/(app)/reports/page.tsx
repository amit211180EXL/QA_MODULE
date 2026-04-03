'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi, type SlaReportDay, type FormScoreDistribution } from '@/lib/analytics-api';
import { Topbar } from '@/components/layout/topbar';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Download,
  Users,
  ShieldCheck,
  MessageSquare,
  Clock,
  FileText,
  TrendingUp,
  User,
  Loader2,
  AlertCircle,
} from 'lucide-react';

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      headers
        .map((h) => {
          const v = r[h];
          const s = v === null || v === undefined ? '' : String(v);
          return s.includes(',') || s.includes('"') ? '"' + s.replace(/"/g, '""') + '"' : s;
        })
        .join(','),
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const PRESETS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
];

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

function KpiCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function ReportTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | number | null | undefined)[][];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full table-auto text-sm">
        <thead className="bg-gradient-to-r from-slate-50 to-slate-100/70">
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, i) => (
            <tr key={i} className="transition-colors hover:bg-slate-50/60">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 text-slate-700 whitespace-nowrap">
                  {cell === null || cell === undefined ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={headers.length}
                className="px-4 py-10 text-center text-sm text-slate-500"
              >
                No data for the selected period.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const TABS = [
  { id: 'agent', label: 'Agent', icon: User },
  { id: 'qa', label: 'QA Performance', icon: Users },
  { id: 'verifier', label: 'Verifier', icon: ShieldCheck },
  { id: 'volume', label: 'Conv. Volume', icon: MessageSquare },
  { id: 'sla', label: 'SLA / Turnaround', icon: Clock },
  { id: 'form', label: 'Form Scores', icon: FileText },
  { id: 'escalation', label: 'Escalation', icon: TrendingUp },
] as const;

type TabId = (typeof TABS)[number]['id'];

function TabPanel({
  isLoading,
  isError,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  children: React.ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-500">
        <Loader2 className="mr-2.5 h-5 w-5 animate-spin text-primary-500" />
        <span className="text-sm font-medium">Loading report…</span>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex items-center justify-center gap-3 rounded-xl border border-red-200 bg-red-50 py-10 text-sm text-red-700">
        <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-500" />
        <span>Failed to load report data. Please try again or adjust the date range.</span>
      </div>
    );
  }
  return <>{children}</>;
}

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('agent');
  const [fromDate, setFromDate] = useState(daysAgo(30));
  const [toDate, setToDate] = useState(today());
  const [activePreset, setActivePreset] = useState<number | null>(30);

  const from = useMemo(() => new Date(fromDate), [fromDate]);
  const to = useMemo(() => {
    const d = new Date(toDate);
    d.setHours(23, 59, 59, 999);
    return d;
  }, [toDate]);

  // Track which tabs have ever been visited so that we keep fetched data alive
  // even after switching away (avoids re-fetching on every tab switch).
  const [visitedTabs, setVisitedTabs] = useState<Set<TabId>>(new Set(['agent']));

  function switchTab(id: TabId) {
    setActiveTab(id);
    setVisitedTabs((prev) => new Set([...prev, id]));
  }

  const qOpts = { staleTime: 60_000 };
  const agentQ = useQuery({
    queryKey: ['reports', 'agent', fromDate, toDate],
    queryFn: () => analyticsApi.agentPerformance(from, to),
    enabled: visitedTabs.has('agent'),
    ...qOpts,
  });
  const qaQ = useQuery({
    queryKey: ['reports', 'qa', fromDate, toDate],
    queryFn: () => analyticsApi.qaReviewerPerformance(from, to),
    enabled: visitedTabs.has('qa'),
    ...qOpts,
  });
  const verifierQ = useQuery({
    queryKey: ['reports', 'verifier', fromDate, toDate],
    queryFn: () => analyticsApi.verifierReport(from, to),
    enabled: visitedTabs.has('verifier'),
    ...qOpts,
  });
  const volumeQ = useQuery({
    queryKey: ['reports', 'volume', fromDate, toDate],
    queryFn: () => analyticsApi.conversationVolume(from, to),
    enabled: visitedTabs.has('volume'),
    ...qOpts,
  });
  const slaQ = useQuery({
    queryKey: ['reports', 'sla', fromDate, toDate],
    queryFn: () => analyticsApi.slaReport(from, to),
    enabled: visitedTabs.has('sla'),
    ...qOpts,
  });
  const formQ = useQuery({
    queryKey: ['reports', 'form', fromDate, toDate],
    queryFn: () => analyticsApi.formScoreDistribution(from, to),
    enabled: visitedTabs.has('form'),
    ...qOpts,
  });
  const escalationQ = useQuery({
    queryKey: ['reports', 'escalation', fromDate, toDate],
    queryFn: () => analyticsApi.escalationStats(from, to),
    enabled: visitedTabs.has('escalation'),
    ...qOpts,
  });
  const rejectionQ = useQuery({
    queryKey: ['reports', 'rejection', fromDate, toDate],
    queryFn: () => analyticsApi.rejectionReasons(from, to),
    enabled: visitedTabs.has('escalation'),
    ...qOpts,
  });

  function applyPreset(days: number) {
    setActivePreset(days);
    setFromDate(daysAgo(days));
    setToDate(today());
    // Reset visited tabs so all queries re-fetch with the new date range.
    setVisitedTabs(new Set([activeTab]));
  }

  function exportCsv(name: string, rows: Record<string, unknown>[]) {
    downloadCsv(name + '-' + fromDate + '-' + toDate + '.csv', rows);
  }

  const totalConversations = (volumeQ.data ?? []).reduce((s, d) => s + d.conversations, 0);
  const totalEvaluations = (volumeQ.data ?? []).reduce((s, d) => s + d.evaluations, 0);

  const tabContent: Record<TabId, React.ReactNode> = {
    agent: (
      <TabPanel isLoading={agentQ.isPending} isError={agentQ.isError}>
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                exportCsv(
                  'agent-report',
                  (agentQ.data ?? []).map((r) => ({
                    Agent: r.agentName ?? r.agentId ?? '',
                    Evaluations: r.totalEvaluations,
                    'Avg Score (%)': r.avgScore ?? '',
                    'Pass Rate (%)': r.passRate,
                  })),
                )
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export CSV
            </Button>
          </div>
          <ReportTable
            headers={['Agent', 'Evaluations', 'Avg Score', 'Pass Rate']}
            rows={(agentQ.data ?? []).map((r) => [
              r.agentName ?? r.agentId ?? '—',
              r.totalEvaluations,
              r.avgScore != null ? r.avgScore + '%' : null,
              r.passRate + '%',
            ])}
          />
        </div>
      </TabPanel>
    ),
    qa: (
      <TabPanel isLoading={qaQ.isPending} isError={qaQ.isError}>
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                exportCsv(
                  'qa-reviewer-report',
                  (qaQ.data ?? []).map((r) => ({
                    'QA User ID': r.qaUserId ?? '',
                    Reviewed: r.totalReviewed,
                    'Avg QA Score (%)': r.avgQaScore ?? '',
                    'Avg Turnaround (min)': r.avgTurnaroundMinutes ?? '',
                  })),
                )
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export CSV
            </Button>
          </div>
          <ReportTable
            headers={['QA Reviewer ID', 'Reviewed', 'Avg QA Score', 'Avg Turnaround']}
            rows={(qaQ.data ?? []).map((r) => [
              r.qaUserId ?? '—',
              r.totalReviewed,
              r.avgQaScore != null ? r.avgQaScore + '%' : null,
              r.avgTurnaroundMinutes != null ? r.avgTurnaroundMinutes + ' min' : null,
            ])}
          />
        </div>
      </TabPanel>
    ),
    verifier: (
      <TabPanel isLoading={verifierQ.isPending} isError={verifierQ.isError}>
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                exportCsv(
                  'verifier-report',
                  (verifierQ.data ?? []).map((r) => ({
                    'Verifier ID': r.verifierUserId ?? '',
                    Verified: r.totalVerified,
                    Rejected: r.totalRejected,
                    'Reject Rate (%)': r.rejectRate,
                    'Avg Score (%)': r.avgVerifierScore ?? '',
                  })),
                )
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export CSV
            </Button>
          </div>
          <ReportTable
            headers={['Verifier ID', 'Verified', 'Rejected', 'Reject Rate', 'Avg Score']}
            rows={(verifierQ.data ?? []).map((r) => [
              r.verifierUserId ?? '—',
              r.totalVerified,
              r.totalRejected,
              r.rejectRate + '%',
              r.avgVerifierScore != null ? r.avgVerifierScore + '%' : null,
            ])}
          />
        </div>
      </TabPanel>
    ),
    volume: (
      <TabPanel isLoading={volumeQ.isPending} isError={volumeQ.isError}>
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="grid grid-cols-2 gap-3">
              <KpiCard label="Total Uploaded" value={totalConversations} />
              <KpiCard label="Total Evaluations" value={totalEvaluations} />
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                exportCsv(
                  'conversation-volume',
                  (volumeQ.data ?? []).map((r) => ({
                    Date: r.date,
                    Conversations: r.conversations,
                    Evaluations: r.evaluations,
                  })),
                )
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export CSV
            </Button>
          </div>
          <ReportTable
            headers={['Date', 'Conversations', 'Evaluations']}
            rows={(volumeQ.data ?? []).map((r) => [r.date, r.conversations, r.evaluations])}
          />
        </div>
      </TabPanel>
    ),
    sla: (
      <TabPanel isLoading={slaQ.isPending} isError={slaQ.isError}>
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            {slaQ.data?.summary && (
              <div className="grid grid-cols-2 gap-3">
                <KpiCard
                  label="Avg Turnaround"
                  value={
                    slaQ.data.summary.avgTurnaroundHours != null
                      ? slaQ.data.summary.avgTurnaroundHours + 'h'
                      : '—'
                  }
                  sub="upload → locked"
                />
                <KpiCard
                  label="Total Completed"
                  value={slaQ.data.summary.totalCompleted}
                  sub="in period"
                />
              </div>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                exportCsv(
                  'sla-report',
                  (slaQ.data?.byDay ?? []).map((r) => ({
                    Date: r.date,
                    'Avg (hrs)': r.avgTurnaroundHours ?? '',
                    'Min (hrs)': r.minTurnaroundHours ?? '',
                    'Max (hrs)': r.maxTurnaroundHours ?? '',
                    Count: r.count,
                  })),
                )
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export CSV
            </Button>
          </div>
          <ReportTable
            headers={['Date', 'Avg (hrs)', 'Min (hrs)', 'Max (hrs)', 'Count']}
            rows={(slaQ.data?.byDay ?? []).map((r: SlaReportDay) => [
              r.date,
              r.avgTurnaroundHours,
              r.minTurnaroundHours,
              r.maxTurnaroundHours,
              r.count,
            ])}
          />
        </div>
      </TabPanel>
    ),
    form: (
      <TabPanel isLoading={formQ.isPending} isError={formQ.isError}>
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const rows: Record<string, unknown>[] = [];
                for (const f of formQ.data ?? [])
                  for (const b of f.buckets)
                    rows.push({ Form: f.formName, Bucket: b.label, Count: b.count });
                exportCsv('form-score-distribution', rows);
              }}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export CSV
            </Button>
          </div>
          {(formQ.data ?? []).length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              No completed evaluations in the selected period.
            </p>
          ) : (
            <div className="space-y-6">
              {(formQ.data ?? []).map((form: FormScoreDistribution) => (
                <div key={form.formKey}>
                  <p className="mb-2 text-sm font-semibold text-slate-700">{form.formName}</p>
                  <ReportTable
                    headers={['Score Bucket', 'Count']}
                    rows={form.buckets.map((b) => [b.label, b.count])}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </TabPanel>
    ),
    escalation: (
      <TabPanel
        isLoading={escalationQ.isPending || rejectionQ.isPending}
        isError={escalationQ.isError || rejectionQ.isError}
      >
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="grid grid-cols-2 gap-3">
              <KpiCard label="Escalated (period)" value={escalationQ.data?.escalated ?? '—'} />
              <KpiCard
                label="Pending Escalation"
                value={escalationQ.data?.pendingEscalation ?? '—'}
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                exportCsv('escalation-report', [
                  {
                    Escalated: escalationQ.data?.escalated ?? 0,
                    Pending: escalationQ.data?.pendingEscalation ?? 0,
                  },
                ])
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export CSV
            </Button>
          </div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Common Rejection Reasons
          </p>
          <ReportTable
            headers={['Reason', 'Count', 'Rate']}
            rows={(rejectionQ.data ?? []).map((r) => [r.reason, r.count, r.rate + '%'])}
          />
        </div>
      </TabPanel>
    ),
  };

  return (
    <>
      <Topbar title="Reports" />
      <div className="space-y-6">
        <PageHeader
          eyebrow="Insights"
          title="Reports"
          titleGradient
          description="Detailed performance reports with CSV export. Select a date range to filter all reports."
        />

        <Card shadow="sm" className="border-slate-200/90 bg-white">
          <CardBody>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  From
                </label>
                <input
                  type="date"
                  value={fromDate}
                  max={toDate}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    setActivePreset(null);
                    setVisitedTabs(new Set([activeTab]));
                  }}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-primary-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  To
                </label>
                <input
                  type="date"
                  value={toDate}
                  min={fromDate}
                  onChange={(e) => {
                    setToDate(e.target.value);
                    setActivePreset(null);
                    setVisitedTabs(new Set([activeTab]));
                  }}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-primary-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                />
              </div>
              <div className="flex gap-2 pb-0.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.days}
                    onClick={() => applyPreset(p.days)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${activePreset === p.days ? 'bg-primary-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    Last {p.label}
                  </button>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>

        <Card shadow="sm" className="overflow-hidden border-slate-200/90 bg-white">
          <div className="overflow-x-auto border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
            <div className="flex min-w-max">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => switchTab(tab.id)}
                    className={`flex items-center gap-2 border-b-2 px-5 py-3.5 text-sm font-medium transition-colors whitespace-nowrap ${active ? 'border-primary-600 bg-white text-primary-700' : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'}`}
                  >
                    <Icon className={`h-4 w-4 ${active ? 'text-primary-600' : 'text-slate-400'}`} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
          <CardBody className="p-6">{tabContent[activeTab]}</CardBody>
        </Card>
      </div>
    </>
  );
}
