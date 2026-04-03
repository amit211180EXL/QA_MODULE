'use client';

import { useEffect, useState } from 'react';
import { AxiosError } from 'axios';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, usePathname, useRouter } from 'next/navigation';
import {
  evaluationsApi,
  FormQuestion,
  FormSection,
  ResponseLayer,
  AnswerRecord,
  type AuditLogEntry,
} from '@/lib/evaluations-api';
import { settingsApi } from '@/lib/api';
import { CallReviewPanel } from '@/components/conversations/call-review-panel';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { useAuth } from '@/context/auth-context';
import { CheckCircle, XCircle, ArrowLeft, AlertTriangle } from 'lucide-react';
import { Topbar } from '@/components/layout/topbar';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';

type SubmissionNotice = {
  variant: 'info' | 'success' | 'danger';
  message: string;
};

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function scaleValue(value: number, min: number, max: number, scale: number): number {
  if (max <= min) {
    return Math.min(Math.max(value, 0), scale);
  }

  const clamped = Math.min(Math.max(value, min), max);
  return ((clamped - min) / (max - min)) * scale;
}

function normalizeAnswer(value: unknown, question: FormQuestion, scale: number): number {
  switch (question.type) {
    case 'rating': {
      if (typeof value !== 'number') return 0;
      const min = question.validation?.min ?? 0;
      const max = question.validation?.max ?? 5;
      return scaleValue(value, min, max, scale);
    }
    case 'boolean':
      return value === true || value === 1 || value === 'yes' || value === 'true' ? scale : 0;
    case 'select':
    case 'multiselect':
      if (typeof value === 'number') {
        if (question.validation?.max !== undefined || question.validation?.min !== undefined) {
          return scaleValue(value, question.validation?.min ?? 0, question.validation?.max ?? scale, scale);
        }
        return value;
      }
      if (typeof value === 'string') {
        const parsed = parseFloat(value);
        if (Number.isNaN(parsed)) return 0;
        if (question.validation?.max !== undefined || question.validation?.min !== undefined) {
          return scaleValue(parsed, question.validation?.min ?? 0, question.validation?.max ?? scale, scale);
        }
        return parsed;
      }
      return 0;
    default:
      return 0;
  }
}

function computeScorePreview(
  answers: Record<string, unknown>,
  questions: FormQuestion[],
  sections: FormSection[],
  strategy: { passMark: number; scale: number },
) {
  const scale = strategy.scale ?? 100;
  const sectionScores: Record<string, number> = {};
  let totalWeight = 0;
  let weightedTotal = 0;

  for (const section of sections) {
    const sectionQuestions = questions.filter((question) => question.sectionId === section.id);
    if (!sectionQuestions.length) continue;

    const totalQuestionWeight = sectionQuestions.reduce((sum, question) => sum + question.weight, 0);
    let sectionRaw = 0;

    for (const question of sectionQuestions) {
      const answer = answers[question.key];
      if (answer === undefined || answer === null || answer === '') continue;
      const normalized = normalizeAnswer(answer, question, scale);
      sectionRaw += (normalized / scale) * question.weight;
    }

    const sectionScore = totalQuestionWeight > 0 ? (sectionRaw / totalQuestionWeight) * scale : 0;
    const roundedSectionScore = roundScore(sectionScore);
    sectionScores[section.id] = roundedSectionScore;
    totalWeight += section.weight;
    weightedTotal += roundedSectionScore * section.weight;
  }

  const overallScore = totalWeight > 0 ? roundScore(weightedTotal / totalWeight) : 0;
  return {
    overallScore,
    passFail: overallScore >= strategy.passMark,
    sectionScores,
  };
}

function derivePassFail(
  score: number | null | undefined,
  passMark: number,
  fallback?: boolean | null,
): boolean | null {
  if (typeof score === 'number') return score >= passMark;
  return fallback ?? null;
}

function getMutationMessage(error: unknown, fallback: string): string {
  const axiosError = error as AxiosError<{ error?: { message?: string } }> | null;
  return axiosError?.response?.data?.error?.message ?? fallback;
}

// ─── Conditional logic evaluator ─────────────────────────────────────────────

function isQuestionVisible(q: FormQuestion, answers: Record<string, unknown>): boolean {
  if (!q.conditionalLogic) return true;
  const { questionKey, operator, value } = q.conditionalLogic.showIf;
  const answer = answers[questionKey];
  if (answer === undefined || answer === null) return false;

  const normalize = (v: unknown): string | number | boolean => {
    if (typeof v === 'boolean') return v;
    if (v === 'true') return true;
    if (v === 'false') return false;
    const n = Number(v);
    if (!Number.isNaN(n) && v !== '') return n;
    return String(v);
  };

  const a = normalize(answer);
  const b = normalize(value);
  switch (operator) {
    case 'eq':
      return a === b;
    case 'neq':
      return a !== b;
    case 'gt':
      return Number(answer) > Number(value);
    case 'lt':
      return Number(answer) < Number(value);
    default:
      return true;
  }
}

// ─── Answer input per question type ──────────────────────────────────────────

function QuestionInput({
  question,
  value,
  onChange,
  aiValue,
  overrideReason,
  onOverrideReasonChange,
  readonly,
}: {
  question: FormQuestion;
  value: unknown;
  onChange: (v: unknown) => void;
  aiValue?: unknown;
  overrideReason?: string;
  onOverrideReasonChange?: (r: string) => void;
  readonly?: boolean;
}) {
  const changed = value !== undefined && value !== aiValue && aiValue !== undefined;

  return (
    <div
      className={`rounded-xl border bg-white transition-shadow hover:shadow-sm ${
        changed ? 'border-amber-300 ring-1 ring-amber-200' : 'border-slate-200'
      }`}
    >
      {/* Header row: label + AI badge + weight badge */}
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug text-slate-900">{question.label}</p>
          {question.rubric?.goal && (
            <p className="mt-0.5 text-xs text-slate-400">{question.rubric.goal}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {aiValue !== undefined && (
            <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-600">
              AI: {String(aiValue)}
            </span>
          )}
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
            ×{question.weight}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="border-t border-slate-100 px-4 py-3">
        {question.type === 'rating' && (
          <div className="flex flex-wrap gap-1.5">
            {question.rubric?.anchors
              ? question.rubric.anchors.map((a) => (
                  <button
                    key={a.value}
                    type="button"
                    disabled={readonly}
                    onClick={() => !readonly && onChange(a.value)}
                    className={`flex flex-col items-center rounded-lg px-3 py-2 text-xs transition-all ${
                      value === a.value
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed'
                    }`}
                    title={a.label}
                  >
                    <span className="font-bold">{a.value}</span>
                    <span className="max-w-14 text-center leading-tight">{a.label}</span>
                  </button>
                ))
              : Array.from({ length: (question.validation?.max ?? 5) + 1 }, (_, i) => i).map(
                  (i) => (
                    <button
                      key={i}
                      type="button"
                      disabled={readonly}
                      onClick={() => !readonly && onChange(i)}
                      className={`h-9 w-9 rounded-lg text-sm font-semibold transition-all ${
                        value === i
                          ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed'
                      }`}
                    >
                      {i}
                    </button>
                  ),
                )}
          </div>
        )}

        {question.type === 'boolean' && (
          <div className="flex gap-2">
            {([true, false] as const).map((v) => (
              <button
                key={String(v)}
                type="button"
                disabled={readonly}
                onClick={() => !readonly && onChange(v)}
                className={`rounded-lg px-5 py-1.5 text-sm font-semibold transition-all ${
                  value === v
                    ? v
                      ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-200'
                      : 'bg-red-500 text-white shadow-sm shadow-red-200'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed'
                }`}
              >
                {v ? '✓ Yes' : '✗ No'}
              </button>
            ))}
          </div>
        )}

        {question.type === 'select' && question.options && (
          <select
            disabled={readonly}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
          >
            <option value="">Select…</option>
            {question.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}

        {question.type === 'text' && (
          <textarea
            disabled={readonly}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            rows={2}
            className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
          />
        )}
      </div>

      {/* Override reason — inline amber footer */}
      {changed && !readonly && onOverrideReasonChange && (
        <div className="flex items-center gap-2 border-t border-amber-100 bg-amber-50/60 px-4 py-2">
          <span className="shrink-0 text-[11px] font-semibold text-amber-600">Override reason:</span>
          <input
            type="text"
            placeholder="Required…"
            value={overrideReason ?? ''}
            onChange={(e) => onOverrideReasonChange(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-amber-200 bg-white px-2 py-1 text-xs text-slate-800 placeholder-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
        </div>
      )}
    </div>
  );
}

// ─── Score summary card ───────────────────────────────────────────────────────

function ScoreCard({
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
  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm backdrop-blur-sm transition ${
        active
          ? 'border-primary-200 bg-gradient-to-br from-primary-50/90 to-white ring-1 ring-primary-200/80'
          : 'border-slate-200/90 bg-white/90 hover:shadow-md'
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      {score !== null ? (
        <>
          <p className={`mt-1 text-2xl font-black tabular-nums ${
            passFail === true ? 'text-emerald-600' : passFail === false ? 'text-red-500' : 'text-slate-800'
          }`}>
            {score.toFixed(1)}%
          </p>
          {passFail !== undefined && passFail !== null && (
            <p className={`mt-0.5 text-xs font-semibold ${
              passFail ? 'text-emerald-600' : 'text-red-500'
            }`}>
              {passFail ? '✓ Pass' : '✗ Fail'}
            </p>
          )}
        </>
      ) : (
        <p className="mt-1 text-xl font-bold text-slate-200">—</p>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function EvaluationReviewPage() {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const verifierContext = pathname?.startsWith('/verifier-queue') ?? false;
  const queryClient = useQueryClient();
  const [isResolvingLegacyId, setIsResolvingLegacyId] = useState(false);

  const [localAnswers, setLocalAnswers] = useState<Record<string, unknown>>({});
  const [overrideReasons, setOverrideReasons] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  const [verifierRejectReason, setVerifierRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [submissionNotice, setSubmissionNotice] = useState<SubmissionNotice | null>(null);

  const {
    data: ev,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['evaluation', id],
    queryFn: () => evaluationsApi.get(id),
    enabled: Boolean(id),
  });

  useEffect(() => {
    const axiosErr = error as AxiosError<{ error?: { message?: string } }> | null;
    if (!id || !isError || axiosErr?.response?.status !== 404 || isResolvingLegacyId) {
      return;
    }

    let cancelled = false;
    setIsResolvingLegacyId(true);

    (async () => {
      try {
        const [qa, verifier] = await Promise.all([
          evaluationsApi.listQaQueue(1, 200),
          evaluationsApi.listVerifierQueue(1, 200),
        ]);
        const all = [...qa.items, ...verifier.items];
        const match = all.find((item) => item.id === id);
        if (match && !cancelled) {
          router.replace(`/qa-queue/${match.evaluationId}`);
        }
      } finally {
        if (!cancelled) setIsResolvingLegacyId(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [error, id, isError, isResolvingLegacyId, router]);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get(),
    staleTime: 60_000,
  });

  const { data: auditLog } = useQuery<AuditLogEntry[]>({
    queryKey: ['evaluation-audit', id],
    queryFn: () => evaluationsApi.getAuditLog(id),
    staleTime: 30_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['evaluation', id] });

  const showSubmitting = (message: string) =>
    setSubmissionNotice({ variant: 'info', message });

  const showSuccessAndRedirect = (message: string, target: string) => {
    setSubmissionNotice({ variant: 'success', message });
    window.setTimeout(() => {
      router.push(target);
    }, 900);
  };

  const showError = (error: unknown, fallback: string) => {
    setSubmissionNotice({ variant: 'danger', message: getMutationMessage(error, fallback) });
  };

  const qaStartMutation = useMutation({
    mutationFn: () => evaluationsApi.qaStart(id),
    onMutate: () => setSubmissionNotice(null),
    onSuccess: invalidate,
  });
  const qaSubmitMutation = useMutation({
    mutationFn: () => {
      const adjustedAnswers: Record<string, { value: unknown; overrideReason?: string }> = {};
      for (const [key, value] of Object.entries(localAnswers)) {
        adjustedAnswers[key] = { value, overrideReason: overrideReasons[key] };
      }
      return evaluationsApi.qaSubmit(id, { adjustedAnswers, feedback });
    },
    onMutate: () => showSubmitting('Submitting QA review...'),
    onSuccess: () => {
      invalidate();
      showSuccessAndRedirect('QA review submitted successfully. Sending item to the next queue...', '/qa-queue');
    },
    onError: (error) => showError(error, 'Failed to submit QA review. Please try again.'),
  });

  const verifierStartMutation = useMutation({
    mutationFn: () => evaluationsApi.verifierStart(id),
    onMutate: () => setSubmissionNotice(null),
    onSuccess: invalidate,
  });
  const verifierApproveMutation = useMutation({
    mutationFn: () => evaluationsApi.verifierApprove(id),
    onMutate: () => showSubmitting('Approving evaluation...'),
    onSuccess: () => {
      invalidate();
      showSuccessAndRedirect('Verifier approval completed successfully.', '/verifier-queue');
    },
    onError: (error) => showError(error, 'Failed to approve evaluation. Please try again.'),
  });
  const verifierModifyMutation = useMutation({
    mutationFn: () => {
      const modifiedAnswers: Record<string, { value: unknown; overrideReason: string }> = {};
      for (const [key, value] of Object.entries(localAnswers)) {
        modifiedAnswers[key] = { value, overrideReason: overrideReasons[key] ?? '' };
      }
      return evaluationsApi.verifierModify(id, { modifiedAnswers, feedback });
    },
    onMutate: () => showSubmitting('Submitting verifier changes...'),
    onSuccess: () => {
      invalidate();
      showSuccessAndRedirect('Verifier changes saved and approved successfully.', '/verifier-queue');
    },
    onError: (error) => showError(error, 'Failed to modify and approve evaluation. Please try again.'),
  });
  const verifierRejectMutation = useMutation({
    mutationFn: () => evaluationsApi.verifierReject(id, verifierRejectReason),
    onMutate: () => showSubmitting('Rejecting evaluation back to QA...'),
    onSuccess: () => {
      invalidate();
      showSuccessAndRedirect('Evaluation rejected back to QA successfully.', '/verifier-queue');
    },
    onError: (error) => showError(error, 'Failed to reject evaluation. Please try again.'),
  });

  if (isLoading) {
    return (
      <>
        <Topbar title={verifierContext ? 'Verifier review' : 'QA review'} />
        <div className="py-20 text-center text-sm text-slate-500">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-primary-500" />
          Loading evaluation…
        </div>
      </>
    );
  }
  if (isError || !ev) {
    const axiosErr = error as AxiosError<{ error?: { message?: string } }> | null;
    const status = axiosErr?.response?.status;
    const apiMessage = axiosErr?.response?.data?.error?.message;
    const detail =
      apiMessage ??
      (status === 404
        ? 'Evaluation not found. It may have been moved or remapped.'
        : status === 401
          ? 'Your session has expired. Please log in again.'
          : status === 403
            ? 'You do not have permission to view this evaluation.'
            : 'Please retry from the QA queue.');
    return (
      <>
        <Topbar title={verifierContext ? 'Verifier review' : 'QA review'} />
        <div className="space-y-4">
          <Alert variant="danger">
            {isResolvingLegacyId
              ? 'Resolving old review link...'
              : 'Failed to load evaluation. '}
            {!isResolvingLegacyId && detail}
            {!isResolvingLegacyId && status ? ` (HTTP ${status})` : ''}
          </Alert>
          <Button
            variant="secondary"
            onClick={() => router.push(verifierContext ? '/verifier-queue' : '/qa-queue')}
          >
            {verifierContext ? 'Back to verifier queue' : 'Back to QA queue'}
          </Button>
        </div>
      </>
    );
  }

  const isQaMode = ev.workflowState === 'QA_PENDING' || ev.workflowState === 'QA_IN_PROGRESS';
  const _isVerifierMode =
    ev.workflowState === 'VERIFIER_IN_PROGRESS' || ev.workflowState === 'QA_COMPLETED';
  const isLocked = ev.workflowState === 'LOCKED';
  const canEditQA = ev.workflowState === 'QA_IN_PROGRESS' && ev.qaUserId === user?.id;
  const canEditVerifier =
    ev.workflowState === 'VERIFIER_IN_PROGRESS' && ev.verifierUserId === user?.id;

  // Blind review: mask agent when the reviewer is QA (not verifier)
  const hideAgent = !canEditVerifier && (settings?.blindReview?.hideAgentFromQA ?? false);
  // Deterministic short hash from agentId/agentName for masked display
  const agentDisplay = hideAgent
    ? (() => {
        const raw = ev.conversation.agentName ?? 'unknown';
        let h = 0;
        for (let i = 0; i < raw.length; i++) h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
        return `Agent #${(h >>> 0).toString(16).slice(0, 4)}`;
      })()
    : (ev.conversation.agentName ?? 'Unknown agent');

  // Blind review: hide QA score card from verifier
  const hideQAScore = canEditVerifier && (settings?.blindReview?.hideQAFromVerifier ?? false);
  // Source of truth for displayed answers
  const baseLayer: ResponseLayer | null = canEditVerifier
    ? ev.qaAdjustedData
    : canEditQA
      ? ev.aiResponseData
      : (ev.verifierFinalData ?? ev.qaAdjustedData ?? ev.aiResponseData);

  const sections = [...(ev.formDefinition.sections ?? [])].sort((a, b) => a.order - b.order);
  const questions = [...(ev.formDefinition.questions ?? [])].sort((a, b) => a.order - b.order);

  const getAnswer = (key: string) => {
    if (localAnswers[key] !== undefined) return localAnswers[key];
    return (baseLayer?.answers[key] as AnswerRecord | undefined)?.value;
  };

  const getAiAnswer = (key: string) =>
    (ev.aiResponseData?.answers[key] as AnswerRecord | undefined)?.value;

  const isEditable = canEditQA || canEditVerifier;
  // Build answers map for conditional logic — recalculated on every localAnswers change
  const currentAnswersMap: Record<string, unknown> = Object.fromEntries(
    questions.map((q) => [q.key, getAnswer(q.key)]),
  );
  const scorePreview = computeScorePreview(
    currentAnswersMap,
    questions,
    sections,
    ev.formDefinition.scoringStrategy,
  );
  const passMark = ev.formDefinition.scoringStrategy.passMark ?? 70;
  const qaDisplayScore = ev.qaScore ?? ev.qaAdjustedData?.overallScore ?? scorePreview.overallScore;
  const qaDisplayPassFail = derivePassFail(qaDisplayScore, passMark, ev.qaAdjustedData?.passFail);
  const aiDisplayPassFail = derivePassFail(ev.aiScore, passMark, ev.aiResponseData?.passFail);
  const finalDisplayPassFail = derivePassFail(ev.finalScore, passMark, ev.passFail);

  return (
    <>
      <Topbar title={verifierContext ? 'Verifier review' : 'QA review'} />
      <div className="mx-auto max-w-[1440px] space-y-6">
      <button
        type="button"
        onClick={() => router.back()}
        className="surface-glass inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:border-primary-200/60"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back
      </button>

      <PageHeader
        eyebrow={verifierContext ? 'Verifier review' : 'QA review'}
        title={ev.formDefinition.name}
        titleGradient
        description={
          <>
            <span className="text-slate-500">v{ev.formDefinition.version}</span>
            <span className="text-slate-400"> · </span>
            <span className="font-mono text-sm text-slate-600">
              {ev.conversation.externalId ?? ev.conversationId.slice(0, 8)}
            </span>
            <span className="text-slate-400"> · </span>
            <span>{ev.conversation.channel}</span>
            <span className="text-slate-400"> · </span>
            <span>{agentDisplay}</span>
            {hideAgent && (
              <Badge variant="accent" size="sm" className="ml-2 align-middle">
                Blind
              </Badge>
            )}
          </>
        }
        aside={
          <div className="surface-glass rounded-full px-1 py-1">
            <Badge variant={isLocked ? 'success' : 'warning'} size="md">
              {ev.workflowState.replace(/_/g, ' ')}
            </Badge>
          </div>
        }
      />

      {/* Rejection reason banner */}
      {ev.verifierRejectReason && (
        <Alert variant="warning" className="mb-4">
          <strong>Rejected by verifier:</strong> {ev.verifierRejectReason}
        </Alert>
      )}

      {submissionNotice && (
        <Alert variant={submissionNotice.variant} className="mb-4">
          {submissionNotice.message}
        </Alert>
      )}

      {/* Score summary */}
      <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <ScoreCard label="AI Score" score={ev.aiScore} passFail={aiDisplayPassFail} />
        {hideQAScore ? (
          <div className="rounded-2xl border border-slate-200/90 bg-white/90 p-4 shadow-sm backdrop-blur-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">QA Score</p>
            <p className="mt-1 text-xl font-bold text-slate-200">Hidden</p>
            <p className="mt-0.5 text-xs text-slate-400">Blind review active</p>
          </div>
        ) : (
          <ScoreCard
            label="QA Score"
            score={qaDisplayScore}
            passFail={qaDisplayPassFail}
            active={isQaMode}
          />
        )}
        <ScoreCard
          label="Final Score"
          score={ev.finalScore}
          passFail={finalDisplayPassFail}
          active={isLocked}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="min-w-0 space-y-6">
          {ev.workflowState === 'QA_PENDING' && (
            <div className="rounded-2xl border border-primary-200/80 bg-gradient-to-r from-primary-50/95 to-accent-50/40 p-4 backdrop-blur-sm">
              <Button isLoading={qaStartMutation.isPending} onClick={() => qaStartMutation.mutate()}>
                Claim for QA Review
              </Button>
            </div>
          )}
          {(ev.workflowState === 'QA_COMPLETED' || ev.workflowState === 'VERIFIER_PENDING') && (
            <div className="rounded-2xl border border-success-200/80 bg-gradient-to-r from-success-50/95 to-primary-50/30 p-4 backdrop-blur-sm">
              <Button
                isLoading={verifierStartMutation.isPending}
                onClick={() => verifierStartMutation.mutate()}
              >
                Claim for Verifier Review
              </Button>
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white/90 shadow-md backdrop-blur-sm">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100/80 bg-gradient-to-r from-slate-50/90 to-white px-5 py-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Evaluation Form</h2>
                <p className="text-xs text-slate-400">Review each section and submit your adjustments.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                {sections.length} section{sections.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="space-y-5 p-4">
              {sections.map((section: FormSection) => {
                const sectionScore = baseLayer?.sectionScores?.[section.id];
                const sqs = questions
                  .filter((q: FormQuestion) => q.sectionId === section.id)
                  .filter((q: FormQuestion) => isQuestionVisible(q, currentAnswersMap));
                if (!sqs.length) return null;
                return (
                  <div key={section.id} className="rounded-2xl border border-slate-200 bg-slate-50/60 px-4 pb-4 pt-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="text-sm font-bold text-slate-800">{section.title}</h3>
                      {typeof (sectionScore ?? scorePreview.sectionScores[section.id]) === 'number' && (
                        <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
                          {(sectionScore ?? scorePreview.sectionScores[section.id]).toFixed(1)}
                        </span>
                      )}
                    </div>
                    <div className="space-y-3">
                      {sqs.map((q: FormQuestion) => (
                        <QuestionInput
                          key={q.id}
                          question={q}
                          value={getAnswer(q.key)}
                          aiValue={getAiAnswer(q.key)}
                          overrideReason={overrideReasons[q.key]}
                          onChange={(v) =>
                            isEditable && setLocalAnswers((prev) => ({ ...prev, [q.key]: v }))
                          }
                          onOverrideReasonChange={(r) =>
                            setOverrideReasons((prev) => ({ ...prev, [q.key]: r }))
                          }
                          readonly={!isEditable}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {isEditable && (
            <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white/90 shadow-md backdrop-blur-sm">
              <div className="border-b border-slate-100/80 bg-gradient-to-r from-slate-50/90 to-white px-4 py-3">
                <label className="text-sm font-semibold text-slate-700">Feedback (optional)</label>
              </div>
              <div className="p-4">
                <textarea
                  rows={3}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Add final reviewer notes, coaching points, or context here…"
                  className="block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                />
              </div>
            </div>
          )}

          {canEditQA && (
            <div className="flex justify-end gap-3 rounded-2xl border border-slate-200/90 bg-white/90 px-4 py-3 shadow-md backdrop-blur-sm">
              <Button isLoading={qaSubmitMutation.isPending} onClick={() => qaSubmitMutation.mutate()}>
                <CheckCircle className="mr-2 h-4 w-4" />
                Submit QA Review
              </Button>
            </div>
          )}

          {canEditVerifier && (
            <div className="space-y-3 overflow-hidden rounded-2xl border border-slate-200/90 bg-white/90 shadow-md backdrop-blur-sm">
              {showRejectInput ? (
                <div className="border-b border-red-100 bg-red-50 p-4 space-y-2">
                  <textarea
                    rows={2}
                    value={verifierRejectReason}
                    onChange={(e) => setVerifierRejectReason(e.target.value)}
                    placeholder="Rejection reason (min 5 chars)"
                    className="block w-full rounded-xl border border-red-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="danger"
                      isLoading={verifierRejectMutation.isPending}
                      disabled={verifierRejectReason.length < 5}
                      onClick={() => verifierRejectMutation.mutate()}
                    >
                      Confirm Rejection
                    </Button>
                    <Button variant="secondary" onClick={() => setShowRejectInput(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap justify-end gap-3 px-4 py-3">
                <Button variant="secondary" onClick={() => setShowRejectInput(true)}>
                  <XCircle className="mr-2 h-4 w-4" />
                  Reject to QA
                </Button>
                {Object.keys(localAnswers).length > 0 ? (
                  <Button
                    isLoading={verifierModifyMutation.isPending}
                    onClick={() => verifierModifyMutation.mutate()}
                  >
                    <AlertTriangle className="mr-2 h-4 w-4" />
                    Modify &amp; Approve
                  </Button>
                ) : (
                  <Button
                    isLoading={verifierApproveMutation.isPending}
                    onClick={() => verifierApproveMutation.mutate()}
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Approve
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        <aside className="min-w-0 space-y-6 lg:sticky lg:top-6 lg:self-start">
          <CallReviewPanel
            channel={ev.conversation.channel}
            content={ev.conversation.content}
            metadata={ev.conversation.metadata}
          />

          {ev.deviationRecords.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-sm">
              <div className="border-b border-orange-100 bg-orange-50 px-4 py-3">
                <h3 className="text-sm font-semibold text-orange-900">Deviations</h3>
              </div>
              <div className="space-y-2 p-4">
                {ev.deviationRecords.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between rounded-xl border border-orange-100 bg-orange-50/50 px-4 py-2.5 text-sm"
                  >
                    <span className="font-medium text-orange-800">{d.type.replace(/_/g, ' ')}</span>
                    <span className="font-mono text-xs text-orange-700">
                      {d.scoreA.toFixed(1)} → {d.scoreB.toFixed(1)}{' '}
                      <span className="font-bold">Δ{d.deviation.toFixed(1)}%</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {auditLog && auditLog.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <details className="group" open>
                <summary className="flex cursor-pointer list-none items-center gap-2 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-4 py-3 text-sm font-semibold text-slate-800">
                  <span className="mr-1 text-slate-400 transition-transform group-open:rotate-90">▶</span>
                  Audit Trail
                  <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                    {auditLog.length} event{auditLog.length !== 1 ? 's' : ''}
                  </span>
                </summary>
                <div className="space-y-2 p-4">
                  {auditLog.map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">
                          {entry.action.replace(/_/g, ' ')}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            entry.actorRole === 'ADMIN'
                              ? 'bg-fuchsia-100 text-fuchsia-700'
                              : entry.actorRole === 'QA'
                                ? 'bg-blue-100 text-blue-700'
                                : entry.actorRole === 'VERIFIER'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {entry.actorRole}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-400">
                        {new Date(entry.createdAt).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        · {entry.actorId.slice(0, 8)}
                      </div>
                        {entry.metadata != null && (
                        <div className="mt-1.5 text-xs text-slate-500">
                          {typeof entry.metadata === 'object'
                              ? Object.entries(entry.metadata as Record<string, unknown>)
                                .map(([k, v]) => `${k}: ${String(v)}`)
                                  .join(', ')
                            : String(entry.metadata as string | number | boolean)}
                        </div>
                      )}
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}
