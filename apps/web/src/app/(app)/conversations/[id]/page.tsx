'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { conversationsApi, type ConversationDetail } from '@/lib/api';
import { CallReviewPanel } from '@/components/conversations/call-review-panel';
import { Topbar } from '@/components/layout/topbar';
import { PageHeader } from '@/components/layout/page-header';
import { ArrowLeft, CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-600',
  EVALUATING: 'bg-blue-100 text-blue-700',
  QA_REVIEW: 'bg-amber-100 text-amber-700',
  VERIFIER_REVIEW: 'bg-violet-100 text-violet-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-red-100 text-red-600',
};

const WORKFLOW_LABELS: Record<string, string> = {
  AI_PENDING: 'AI Pending',
  AI_PROCESSING: 'AI Processing',
  QA_PENDING: 'QA Review Pending',
  QA_IN_PROGRESS: 'QA In Progress',
  VERIFIER_PENDING: 'Verifier Review Pending',
  VERIFIER_IN_PROGRESS: 'Verifier In Progress',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold tracking-wide ${STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-600'}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2.5 border-b border-slate-50 last:border-0">
      <dt className="w-32 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-700 break-all">{children}</dd>
    </div>
  );
}

// ─── Score tile ───────────────────────────────────────────────────────────────

function ScoreTile({
  label,
  score,
  passFail,
  active,
}: {
  label: string;
  score: number | null;
  passFail?: boolean | null;
  active?: boolean;
}) {
  const colour =
    passFail === true
      ? 'text-emerald-600'
      : passFail === false
        ? 'text-red-500'
        : 'text-slate-700';

  return (
    <div
      className={`flex flex-col items-center justify-center rounded-2xl border px-5 py-4 text-center shadow-sm transition ${
        active
          ? 'border-primary-200 bg-gradient-to-br from-primary-50/90 to-white ring-1 ring-primary-200/80'
          : 'border-slate-200/90 bg-white/90 backdrop-blur-sm hover:shadow-md'
      }`}
    >
      <span className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        {label}
      </span>
      {score !== null ? (
        <>
          <span className={`text-3xl font-black tabular-nums ${colour}`}>{score.toFixed(1)}%</span>
          {passFail !== null && passFail !== undefined && (
            <span className={`mt-1.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${passFail ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
              {passFail ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <XCircle className="h-3 w-3" />
              )}
              {passFail ? 'Pass' : 'Fail'}
            </span>
          )}
        </>
      ) : (
        <span className="text-2xl font-bold text-slate-200">—</span>
      )}
    </div>
  );
}

// ─── Score summary banner ─────────────────────────────────────────────────────

function ScoreSummaryBanner({ conv }: { conv: ConversationDetail }) {
  const ev = conv.evaluation;
  if (!ev) return null;

  const isLocked = ev.workflowState === 'LOCKED';
  const isQa =
    ev.workflowState === 'QA_PENDING' || ev.workflowState === 'QA_IN_PROGRESS';
  const isVerifier =
    ev.workflowState === 'VERIFIER_PENDING' || ev.workflowState === 'VERIFIER_IN_PROGRESS';
  const isEscalated = ev.isEscalated;

  const needsReview = isQa || isVerifier;

  const reviewHref = isQa ? `/qa-queue/${ev.id}` : `/verifier-queue/${ev.id}`;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white/90 shadow-md backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100/80 bg-gradient-to-r from-slate-50/90 to-white px-5 py-3">
        <div className="flex items-center gap-2">
          {isLocked ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : isEscalated ? (
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          ) : (
            <Clock className="h-4 w-4 text-amber-500" />
          )}
          <span className="text-sm font-semibold text-slate-800">
            {WORKFLOW_LABELS[ev.workflowState] ?? ev.workflowState.replace(/_/g, ' ')}
          </span>
          {isEscalated && (
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700">
              Escalated
            </span>
          )}
        </div>
        {needsReview && (
          <Link
            href={reviewHref}
            className="rounded-full bg-gradient-to-r from-primary-600 to-primary-500 px-4 py-1.5 text-xs font-semibold text-white shadow-md shadow-primary-600/25 transition hover:brightness-105"
          >
            Open review →
          </Link>
        )}
      </div>

      {/* Score tiles */}
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
        <ScoreTile label="AI Score" score={ev.aiScore} />
        <ScoreTile label="QA Score" score={ev.qaScore} active={isQa} />
        <ScoreTile
          label="Verifier Score"
          score={ev.verifierScore}
          active={isVerifier}
        />
        <ScoreTile
          label="Final Score"
          score={ev.finalScore}
          passFail={ev.passFail}
          active={isLocked}
        />
      </div>

      {/* Extra details */}
      {(ev.feedback || ev.escalationReason) && (
        <div className="border-t border-slate-100 px-5 py-3 text-sm text-slate-600 space-y-1">
          {ev.feedback && (
            <p>
              <span className="font-medium text-slate-700">Feedback: </span>
              {ev.feedback}
            </p>
          )}
          {ev.escalationReason && (
            <p className="text-orange-700">
              <span className="font-medium">Escalation: </span>
              {ev.escalationReason}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ConversationDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;

  const {
    data: conv,
    isLoading,
    isError,
  } = useQuery<ConversationDetail>({
    queryKey: ['conversation', id],
    queryFn: () => conversationsApi.get(id),
    staleTime: 30_000,
  });

  return (
    <>
      <Topbar title="Conversation" />
      <div className="mx-auto max-w-5xl space-y-6">
        <Link
          href="/conversations"
          className="surface-glass inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:border-primary-200/60 hover:text-primary-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back
        </Link>

        {isLoading && (
          <div className="py-20 text-center text-sm text-slate-400">
            <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-primary-500" />
            Loading…
          </div>
        )}

        {isError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            Failed to load conversation. It may not exist or you may not have access.
          </div>
        )}

        {conv && (
          <>
            <PageHeader
              eyebrow="Conversation"
              title={conv.externalId ?? conv.id.slice(0, 8)}
              titleGradient
              description={`${conv.channel} · ${conv.agentName ?? 'Unknown agent'}`}
            />

            <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white/90 shadow-md backdrop-blur-sm">
              <div className="flex items-center justify-between border-b border-slate-100/80 bg-gradient-to-r from-slate-50/90 to-white px-5 py-3.5">
                <h3 className="text-sm font-semibold text-slate-800">Details</h3>
                <StatusBadge status={conv.status} />
              </div>
              <dl className="px-5 py-1">
                <MetaRow label="ID">
                  <span className="font-mono text-xs">{conv.id}</span>
                </MetaRow>
                {conv.externalId && (
                  <MetaRow label="External ID">
                    <span className="font-mono text-xs">{conv.externalId}</span>
                  </MetaRow>
                )}
                <MetaRow label="Channel">{conv.channel}</MetaRow>
                {conv.agentName && <MetaRow label="Agent">{conv.agentName}</MetaRow>}
                {conv.customerRef && <MetaRow label="Customer">{conv.customerRef}</MetaRow>}
                <MetaRow label="Received">{new Date(conv.receivedAt).toLocaleString()}</MetaRow>
              </dl>
            </div>

            {/* Score summary banner (if evaluation present) */}
            <ScoreSummaryBanner conv={conv} />

            <CallReviewPanel
              channel={conv.channel}
              content={conv.content}
              metadata={conv.metadata}
              title={conv.channel === 'CALL' ? 'Call Playback & Transcript' : 'Transcript'}
              transcriptHeightClass="max-h-[640px]"
            />

            {/* Metadata (if present) */}
            {conv.metadata != null && (
              <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white/90 shadow-md backdrop-blur-sm">
                <div className="border-b border-slate-100/80 bg-gradient-to-r from-slate-50/90 to-white px-5 py-3.5">
                  <h3 className="text-sm font-semibold text-slate-800">Raw Metadata</h3>
                </div>
                <div className="px-5 pb-5 pt-3">
                  <pre className="overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-300 leading-relaxed">
                    {JSON.stringify(conv.metadata, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
