'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/auth-context';
import { Topbar } from '@/components/layout/topbar';
import { analyticsApi, type OverviewKpis } from '@/lib/analytics-api';

function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—';
  return n.toFixed(decimals);
}

export default function DashboardPage() {
  const { user } = useAuth();

  const { data: kpis } = useQuery<OverviewKpis>({
    queryKey: ['analytics', 'overview'],
    queryFn: () => analyticsApi.overview(),
    staleTime: 60_000,
  });

  const cards = [
    { label: 'Conversations', value: fmt(kpis?.totalConversations), sub: 'This month' },
    { label: 'Pending QA', value: fmt(kpis?.pendingQA), sub: 'In queue' },
    { label: 'Pending Verifier', value: fmt(kpis?.pendingVerifier), sub: 'In queue' },
    { label: 'Avg Score', value: fmt(kpis?.avgFinalScore, 1), sub: 'Last 30 days' },
    { label: 'Pass Rate', value: kpis?.passRate != null ? `${fmt(kpis.passRate, 1)}%` : '—', sub: 'Last 30 days' },
    { label: 'AI↔QA Deviation', value: fmt(kpis?.avgAiQaDeviation, 2), sub: 'Avg pts' },
  ];

  return (
    <>
      <Topbar title="Dashboard" />
      <div className="p-6">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">
            Welcome back, {user?.name?.split(' ')[0]} 👋
          </h2>
          <p className="mt-1 text-gray-500">Here&apos;s an overview of your QA activity.</p>
        </div>

        {/* KPI cards */}
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {cards.map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
            >
              <p className="text-sm text-gray-500">{card.label}</p>
              <p className="mt-1 text-3xl font-bold text-gray-900">{card.value}</p>
              <p className="mt-1 text-xs text-gray-400">{card.sub}</p>
            </div>
          ))}
        </div>

        {/* Next steps banner if tenant is freshly provisioned */}
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-6 py-5">
          <h3 className="font-semibold text-primary-800">Get started</h3>
          <p className="mt-1 text-sm text-primary-700">
            Set up your LLM config, build a QA form, and upload your first conversation.
          </p>
          <div className="mt-4 flex gap-3 flex-wrap">
            <a href="/settings/llm" className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
              Configure LLM
            </a>
            <a href="/forms/new" className="rounded-lg border border-primary-300 bg-white px-4 py-2 text-sm font-medium text-primary-700 hover:bg-primary-50">
              Create QA Form
            </a>
            <a href="/conversations/upload" className="rounded-lg border border-primary-300 bg-white px-4 py-2 text-sm font-medium text-primary-700 hover:bg-primary-50">
              Upload Conversations
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
