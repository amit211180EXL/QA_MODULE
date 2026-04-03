'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/auth-context';
import { Topbar } from '@/components/layout/topbar';
import { analyticsApi, type OverviewKpis, type EscalationStats } from '@/lib/analytics-api';
import {
  MessageSquare,
  ClipboardCheck,
  ShieldCheck,
  AlertTriangle,
  Star,
  TrendingUp,
  Activity,
} from 'lucide-react';

function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—';
  return n.toFixed(decimals);
}

const CARD_CONFIG = [
  {
    key: 'conversations',
    label: 'Conversations',
    sub: 'This month',
    icon: MessageSquare,
    color: 'bg-gradient-to-br from-primary-500 to-primary-700',
  },
  {
    key: 'pendingQA',
    label: 'Pending QA',
    sub: 'In queue',
    icon: ClipboardCheck,
    color: 'bg-gradient-to-br from-accent-500 to-accent-700',
  },
  {
    key: 'pendingVerifier',
    label: 'Pending Verifier',
    sub: 'In queue',
    icon: ShieldCheck,
    color: 'bg-gradient-to-br from-slate-600 to-slate-800',
  },
  {
    key: 'escalated',
    label: 'Escalated',
    sub: 'Needs attention',
    icon: AlertTriangle,
    color: 'bg-gradient-to-br from-warning-500 to-warning-700',
    alert: true,
  },
  {
    key: 'avgScore',
    label: 'Avg Score',
    sub: 'Last 30 days',
    icon: Star,
    color: 'bg-gradient-to-br from-amber-400 to-amber-600',
  },
  {
    key: 'passRate',
    label: 'Pass Rate',
    sub: 'Last 30 days',
    icon: TrendingUp,
    color: 'bg-gradient-to-br from-success-500 to-success-700',
  },
  {
    key: 'deviation',
    label: 'AI↔QA Gap',
    sub: 'Avg deviation pts',
    icon: Activity,
    color: 'bg-gradient-to-br from-danger-500 to-danger-700',
  },
] as const;

export default function DashboardPage() {
  const { user } = useAuth();

  const { data: kpis } = useQuery<OverviewKpis>({
    queryKey: ['analytics', 'overview'],
    queryFn: () => analyticsApi.overview(),
    staleTime: 60_000,
  });

  const { data: escalation } = useQuery<EscalationStats>({
    queryKey: ['analytics', 'escalation-stats'],
    queryFn: () => analyticsApi.escalationStats(),
    staleTime: 60_000,
  });

  const values: Record<string, string> = {
    conversations: fmt(kpis?.totalConversations),
    pendingQA: fmt(kpis?.pendingQA),
    pendingVerifier: fmt(kpis?.pendingVerifier),
    escalated: fmt(escalation?.pendingEscalation),
    avgScore: kpis?.avgFinalScore != null ? `${fmt(kpis.avgFinalScore, 1)}%` : '—',
    passRate: kpis?.passRate != null ? `${fmt(kpis.passRate, 1)}%` : '—',
    deviation: fmt(kpis?.avgAiQaDeviation, 2),
  };

  const firstName = user?.name?.split(' ')[0] ?? 'there';

  return (
    <>
      <Topbar title="Dashboard" />
      <div className="space-y-6">

        {/* Welcome section */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-2xs font-bold uppercase tracking-[0.2em] text-primary-600/90">
              Command center
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
              Welcome back,{' '}
              <span className="text-gradient-brand">{firstName}</span>{' '}
              <span className="inline-block origin-bottom-right motion-safe:animate-float-slow">👋</span>
            </h1>
            <p className="mt-2 max-w-xl text-base text-slate-600">
              Real-time signal across queues, scores, and escalations — tuned for fast decisions.
            </p>
          </div>
          <div className="surface-glass flex w-fit items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-slate-700">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-500 opacity-40" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
            </span>
            Live data
          </div>
        </div>

        {/* KPI grid - Modern card layout */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CARD_CONFIG.map(({ key, label, sub, icon: Icon, color, ...rest }) => {
            const isAlert =
              'alert' in rest &&
              rest.alert &&
              (escalation?.pendingEscalation ?? 0) > 0;
            return (
              <div
                key={key}
                className={`group relative overflow-hidden rounded-2xl border bg-white/90 p-5 shadow-xs backdrop-blur-sm transition-all duration-base ease-smooth hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary-500/[0.07] ${
                  isAlert
                    ? 'border-warning-200/90 ring-1 ring-warning-100'
                    : 'border-slate-200/90 hover:border-primary-200/70'
                }`}
              >
                <div
                  aria-hidden
                  className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br from-primary-400/10 to-accent-500/5 blur-2xl transition-opacity duration-slow group-hover:opacity-100 opacity-70"
                />
                <div
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-80"
                />

                <div
                  className={`relative mb-4 flex h-11 w-11 items-center justify-center rounded-xl ${color} text-white shadow-lg ring-2 ring-white/30 transition-transform duration-base group-hover:scale-105`}
                >
                  <Icon className="h-5 w-5 drop-shadow-sm" />
                </div>

                <p className="relative text-2xs font-bold uppercase tracking-wider text-slate-500">
                  {label}
                </p>
                <p
                  className={`relative mt-2 text-3xl font-bold tabular-nums leading-tight tracking-tight ${
                    isAlert ? 'text-warning-600' : 'text-slate-900'
                  }`}
                >
                  {values[key]}
                </p>
                <p className="relative mt-2 text-xs font-medium text-slate-500">{sub}</p>
              </div>
            );
          })}
        </div>

        {/* CTA Banner — gradient mesh + animated edge */}
        <div className="relative overflow-hidden rounded-2xl p-[1px] shadow-lg shadow-primary-500/10 motion-safe:animate-border-glow">
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-r from-primary-400 via-accent-500 to-primary-600 bg-gradient-wide motion-safe:animate-gradient-shift opacity-90"
          />
          <div className="relative overflow-hidden rounded-2xl border border-white/20 bg-gradient-to-br from-primary-50/95 via-white to-accent-50/90 backdrop-blur-sm">
            <div className="absolute -right-24 -top-24 h-56 w-56 rounded-full bg-primary-400/20 blur-3xl" />
            <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-accent-400/15 blur-3xl" />

            <div className="relative flex flex-col gap-6 px-6 py-7 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="inline-flex items-center gap-2 rounded-full border border-primary-200/60 bg-white/60 px-3 py-1 text-2xs font-bold uppercase tracking-widest text-primary-700 shadow-xs backdrop-blur-sm">
                  <span aria-hidden>✦</span> Quick start
                </p>
                <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
                  Ship a sharper QA loop
                </h2>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600">
                  Wire the LLM, publish rubrics, and route conversations — everything stays traceable.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <Link
                  href="/settings/llm"
                  className="inline-flex rounded-xl border border-slate-200/80 bg-white/90 px-4 py-2.5 text-sm font-semibold text-primary-800 shadow-xs backdrop-blur-sm transition-all duration-base hover:border-primary-200 hover:bg-white"
                >
                  LLM settings
                </Link>
                <Link
                  href="/forms/new"
                  className="inline-flex rounded-xl bg-gradient-to-r from-primary-600 to-primary-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-600/25 transition-all duration-base hover:brightness-105"
                >
                  Create form
                </Link>
                <Link
                  href="/upload"
                  className="inline-flex rounded-xl bg-gradient-to-r from-accent-600 to-accent-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-accent-600/20 transition-all duration-base hover:brightness-105"
                >
                  Upload data
                </Link>
              </div>
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
