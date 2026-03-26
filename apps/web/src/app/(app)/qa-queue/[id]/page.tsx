'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { evaluationsApi, FormQuestion, FormSection, ResponseLayer, AnswerRecord } from '@/lib/evaluations-api';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { useAuth } from '@/context/auth-context';
import { CheckCircle, XCircle, ArrowLeft, AlertTriangle } from 'lucide-react';

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
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-800">{question.label}</p>
          {question.rubric && (
            <p className="mt-0.5 text-xs text-gray-500">{question.rubric.goal}</p>
          )}
        </div>
        <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">w={question.weight}</span>
      </div>

      <div className="mt-3">
        {question.type === 'rating' && (
          <div className="flex gap-1">
            {question.rubric?.anchors
              ? question.rubric.anchors.map((a) => (
                  <button
                    key={a.value}
                    type="button"
                    disabled={readonly}
                    onClick={() => !readonly && onChange(a.value)}
                    className={`flex flex-col items-center rounded px-2 py-1 text-xs transition-colors ${
                      value === a.value
                        ? 'bg-primary-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed'
                    }`}
                    title={a.label}
                  >
                    <span className="font-bold">{a.value}</span>
                    <span className="max-w-12 text-center leading-tight">{a.label}</span>
                  </button>
                ))
              : Array.from({ length: (question.validation?.max ?? 5) + 1 }, (_, i) => i).map((i) => (
                  <button
                    key={i}
                    type="button"
                    disabled={readonly}
                    onClick={() => !readonly && onChange(i)}
                    className={`w-8 rounded py-1 text-sm font-medium transition-colors ${
                      value === i ? 'bg-primary-600 text-white' : 'bg-gray-100 hover:bg-gray-200 disabled:cursor-not-allowed'
                    }`}
                  >
                    {i}
                  </button>
                ))}
          </div>
        )}

        {question.type === 'boolean' && (
          <div className="flex gap-2">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                disabled={readonly}
                onClick={() => !readonly && onChange(v)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  value === v ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed'
                }`}
              >
                {v ? 'Yes' : 'No'}
              </button>
            ))}
          </div>
        )}

        {question.type === 'select' && question.options && (
          <select
            disabled={readonly}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
          >
            <option value="">Select…</option>
            {question.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}

        {question.type === 'text' && (
          <textarea
            disabled={readonly}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            rows={2}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
          />
        )}
      </div>

      {/* AI value reference */}
      {aiValue !== undefined && (
        <p className="mt-2 text-xs text-gray-400">
          AI answer: <span className="font-medium text-gray-600">{String(aiValue)}</span>
        </p>
      )}

      {/* Override reason when value was changed */}
      {changed && !readonly && onOverrideReasonChange && (
        <div className="mt-2">
          <input
            type="text"
            placeholder="Override reason (required)"
            value={overrideReason ?? ''}
            onChange={(e) => onOverrideReasonChange(e.target.value)}
            className="block w-full rounded border border-yellow-300 bg-yellow-50 px-2 py-1 text-xs placeholder-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-400"
          />
        </div>
      )}
    </div>
  );
}

// ─── Score summary card ───────────────────────────────────────────────────────

function ScoreCard({ label, score, passFail, active }: { label: string; score: number | null; passFail?: boolean | null; active?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${active ? 'border-primary-300 bg-primary-50' : 'border-gray-200 bg-gray-50'}`}>
      <p className="text-xs font-medium uppercase text-gray-500">{label}</p>
      {score !== null ? (
        <>
          <p className={`mt-1 text-2xl font-bold ${passFail ? 'text-green-600' : 'text-red-600'}`}>
            {score.toFixed(1)}%
          </p>
          {passFail !== undefined && passFail !== null && (
            <p className={`text-xs font-medium ${passFail ? 'text-green-600' : 'text-red-600'}`}>
              {passFail ? 'Pass' : 'Fail'}
            </p>
          )}
        </>
      ) : (
        <p className="mt-1 text-xl text-gray-400">—</p>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function EvaluationReviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [localAnswers, setLocalAnswers] = useState<Record<string, unknown>>({});
  const [overrideReasons, setOverrideReasons] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  const [verifierRejectReason, setVerifierRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  const { data: ev, isLoading, isError } = useQuery({
    queryKey: ['evaluation', id],
    queryFn: () => evaluationsApi.get(id),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['evaluation', id] });

  const qaStartMutation = useMutation({ mutationFn: () => evaluationsApi.qaStart(id), onSuccess: invalidate });
  const qaSubmitMutation = useMutation({
    mutationFn: () => {
      const adjustedAnswers: Record<string, { value: unknown; overrideReason?: string }> = {};
      for (const [key, value] of Object.entries(localAnswers)) {
        adjustedAnswers[key] = { value, overrideReason: overrideReasons[key] };
      }
      return evaluationsApi.qaSubmit(id, { adjustedAnswers, feedback });
    },
    onSuccess: () => { invalidate(); router.push('/qa-queue'); },
  });

  const verifierStartMutation = useMutation({ mutationFn: () => evaluationsApi.verifierStart(id), onSuccess: invalidate });
  const verifierApproveMutation = useMutation({
    mutationFn: () => evaluationsApi.verifierApprove(id),
    onSuccess: () => { invalidate(); router.push('/verifier-queue'); },
  });
  const verifierModifyMutation = useMutation({
    mutationFn: () => {
      const modifiedAnswers: Record<string, { value: unknown; overrideReason: string }> = {};
      for (const [key, value] of Object.entries(localAnswers)) {
        modifiedAnswers[key] = { value, overrideReason: overrideReasons[key] ?? '' };
      }
      return evaluationsApi.verifierModify(id, { modifiedAnswers, feedback });
    },
    onSuccess: () => { invalidate(); router.push('/verifier-queue'); },
  });
  const verifierRejectMutation = useMutation({
    mutationFn: () => evaluationsApi.verifierReject(id, verifierRejectReason),
    onSuccess: () => { invalidate(); router.push('/verifier-queue'); },
  });

  if (isLoading) return <div className="py-16 text-center text-sm text-gray-500">Loading evaluation…</div>;
  if (isError || !ev) return <div className="p-6"><Alert variant="error">Failed to load evaluation.</Alert></div>;

  const isQaMode = ev.workflowState === 'QA_PENDING' || ev.workflowState === 'QA_IN_PROGRESS';
  const isVerifierMode = ev.workflowState === 'VERIFIER_IN_PROGRESS' || ev.workflowState === 'QA_COMPLETED';
  const isLocked = ev.workflowState === 'LOCKED';
  const canEditQA = ev.workflowState === 'QA_IN_PROGRESS' && ev.qaUserId === user?.id;
  const canEditVerifier = ev.workflowState === 'VERIFIER_IN_PROGRESS' && ev.verifierUserId === user?.id;

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

  return (
    <div className="mx-auto max-w-4xl">
      {/* Header */}
      <button onClick={() => router.back()} className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{ev.formDefinition.name} <span className="text-gray-400 text-base font-normal">v{ev.formDefinition.version}</span></h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Conv: {ev.conversation.externalId ?? ev.conversationId.slice(0, 8)} · {ev.conversation.channel} · {ev.conversation.agentName ?? 'Unknown agent'}
          </p>
        </div>
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
          isLocked ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
        }`}>
          {ev.workflowState.replace(/_/g, ' ')}
        </span>
      </div>

      {/* Rejection reason banner */}
      {ev.verifierRejectReason && (
        <Alert variant="warning" className="mb-4">
          <strong>Rejected by verifier:</strong> {ev.verifierRejectReason}
        </Alert>
      )}

      {/* Score summary */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <ScoreCard label="AI Score" score={ev.aiScore} passFail={ev.aiResponseData?.passFail} />
        <ScoreCard label="QA Score" score={ev.qaScore} passFail={ev.qaAdjustedData?.passFail} active={isQaMode} />
        <ScoreCard label="Final Score" score={ev.finalScore} passFail={ev.passFail} active={isLocked} />
      </div>

      {/* Claim buttons */}
      {ev.workflowState === 'QA_PENDING' && (
        <div className="mb-6">
          <Button isLoading={qaStartMutation.isPending} onClick={() => qaStartMutation.mutate()}>
            Claim for QA review
          </Button>
        </div>
      )}
      {(ev.workflowState === 'QA_COMPLETED' || ev.workflowState === 'VERIFIER_PENDING') && (
        <div className="mb-6">
          <Button isLoading={verifierStartMutation.isPending} onClick={() => verifierStartMutation.mutate()}>
            Claim for verifier review
          </Button>
        </div>
      )}

      {/* Conversation content */}
      <details className="mb-6 rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-700 select-none">Conversation content</summary>
        <pre className="overflow-auto p-4 text-xs text-gray-600 max-h-64">
          {JSON.stringify(ev.conversation.content, null, 2)}
        </pre>
      </details>

      {/* Q&A form */}
      <div className="space-y-6">
        {sections.map((section: FormSection) => {
          const sqs = questions.filter((q: FormQuestion) => q.sectionId === section.id);
          if (!sqs.length) return null;
          return (
            <div key={section.id}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-gray-800">{section.title}</h3>
                {baseLayer?.sectionScores?.[section.id] !== undefined && (
                  <span className="text-sm text-gray-500">
                    Section score: <strong>{baseLayer.sectionScores[section.id].toFixed(1)}</strong>
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
                    onChange={(v) => isEditable && setLocalAnswers((prev) => ({ ...prev, [q.key]: v }))}
                    onOverrideReasonChange={(r) => setOverrideReasons((prev) => ({ ...prev, [q.key]: r }))}
                    readonly={!isEditable}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Feedback */}
      {isEditable && (
        <div className="mt-6">
          <label className="mb-1 block text-sm font-medium text-gray-700">Feedback (optional)</label>
          <textarea
            rows={2}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Overall comments…"
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      )}

      {/* QA actions */}
      {canEditQA && (
        <div className="mt-6 flex justify-end gap-3">
          <Button
            isLoading={qaSubmitMutation.isPending}
            onClick={() => qaSubmitMutation.mutate()}
          >
            <CheckCircle className="mr-2 h-4 w-4" />
            Submit QA review
          </Button>
        </div>
      )}

      {/* Verifier actions */}
      {canEditVerifier && (
        <div className="mt-6 space-y-3">
          {showRejectInput ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-2">
              <textarea
                rows={2}
                value={verifierRejectReason}
                onChange={(e) => setVerifierRejectReason(e.target.value)}
                placeholder="Rejection reason (min 5 chars)"
                className="block w-full rounded border border-red-300 px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  isLoading={verifierRejectMutation.isPending}
                  disabled={verifierRejectReason.length < 5}
                  onClick={() => verifierRejectMutation.mutate()}
                >
                  Confirm rejection
                </Button>
                <Button variant="secondary" onClick={() => setShowRejectInput(false)}>Cancel</Button>
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowRejectInput(true)}>
              <XCircle className="mr-2 h-4 w-4" />
              Reject to QA
            </Button>
            {Object.keys(localAnswers).length > 0 ? (
              <Button isLoading={verifierModifyMutation.isPending} onClick={() => verifierModifyMutation.mutate()}>
                <AlertTriangle className="mr-2 h-4 w-4" />
                Modify &amp; approve
              </Button>
            ) : (
              <Button isLoading={verifierApproveMutation.isPending} onClick={() => verifierApproveMutation.mutate()}>
                <CheckCircle className="mr-2 h-4 w-4" />
                Approve
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Deviation records */}
      {ev.deviationRecords.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Deviations</h3>
          <div className="space-y-2">
            {ev.deviationRecords.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-lg bg-orange-50 px-4 py-2 text-sm">
                <span className="text-orange-700">{d.type.replace(/_/g, ' ')}</span>
                <span className="font-medium text-orange-800">
                  {d.scoreA.toFixed(1)} → {d.scoreB.toFixed(1)} = Δ{d.deviation.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
