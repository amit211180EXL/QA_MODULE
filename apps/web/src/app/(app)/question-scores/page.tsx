'use client';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Topbar } from '@/components/layout/topbar';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { conversationsApi } from '@/lib/api';
import {
  evaluationsApi,
  type AnswerRecord,
  type FormQuestion,
  type ResponseLayer,
} from '@/lib/evaluations-api';

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      headers
        .map((h) => {
          const value = r[h];
          const text = value === null || value === undefined ? '' : String(value);
          return text.includes(',') || text.includes('"')
            ? '"' + text.replace(/"/g, '""') + '"'
            : text;
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

function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function formatUtcDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(date);
}

function normalizeAnswer(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—';
  if (typeof value === 'string') return value.trim() ? value : '—';
  if (Array.isArray(value))
    return value.length ? value.map((v) => normalizeAnswer(v)).join(', ') : '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function questionScore(value: unknown, type: FormQuestion['type']): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (type === 'boolean' && typeof value === 'boolean') return value ? 100 : 0;
  return null;
}

function getLayerAnswer(layer: ResponseLayer | null | undefined, key: string): AnswerRecord | null {
  if (!layer?.answers) return null;
  return (layer.answers[key] as AnswerRecord | undefined) ?? null;
}

export default function QuestionScoresPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const convoListQ = useQuery({
    queryKey: ['question-scores', 'conversations', search, page],
    queryFn: () =>
      conversationsApi.list({
        page,
        limit,
        search: search.trim() || undefined,
      }),
    staleTime: 60_000,
  });

  const convoQ = useQuery({
    queryKey: ['question-scores', 'conversation', selectedConversationId],
    queryFn: () => conversationsApi.get(selectedConversationId as string),
    enabled: !!selectedConversationId,
    staleTime: 60_000,
  });

  const evaluationId = convoQ.data?.evaluation?.id ?? null;

  const evalQ = useQuery({
    queryKey: ['question-scores', 'evaluation', evaluationId],
    queryFn: () => evaluationsApi.get(evaluationId as string),
    enabled: !!evaluationId,
    staleTime: 60_000,
  });

  const rows = useMemo(() => {
    const ev = evalQ.data;
    if (!ev) return [];

    const sectionsById = new Map(ev.formDefinition.sections.map((s) => [s.id, s.title]));
    const questions = [...(ev.formDefinition.questions ?? [])].sort((a, b) => a.order - b.order);

    return questions.map((q) => {
      const ai = getLayerAnswer(ev.aiResponseData, q.key)?.value;
      const qa = getLayerAnswer(ev.qaAdjustedData, q.key)?.value;
      const vf = getLayerAnswer(ev.verifierFinalData, q.key)?.value;

      const touched = !sameValue(ai, qa) || !sameValue(qa, vf) || !sameValue(ai, vf);

      return {
        id: q.id,
        section: sectionsById.get(q.sectionId) ?? q.sectionId,
        question: q.label,
        key: q.key,
        touched,
        aiText: normalizeAnswer(ai),
        qaText: normalizeAnswer(qa),
        vfText: normalizeAnswer(vf),
        aiScore: questionScore(ai, q.type),
        qaScore: questionScore(qa, q.type),
        vfScore: questionScore(vf, q.type),
      };
    });
  }, [evalQ.data]);

  const touchedRows = useMemo(() => rows.filter((r) => r.touched), [rows]);

  function openFormModal(conversationId: string) {
    setSelectedConversationId(conversationId);
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
  }

  function exportModalCsv() {
    const csvRows = touchedRows.map((r) => ({
      Section: r.section,
      Question: r.question,
      Key: r.key,
      'AI Answer': r.aiText,
      'QA Answer': r.qaText,
      'Verifier/Final Answer': r.vfText,
      'AI Score': r.aiScore ?? '',
      'QA Score': r.qaScore ?? '',
      'Verifier/Final Score': r.vfScore ?? '',
    }));
    const fileId = convoQ.data?.externalId ?? convoQ.data?.id?.slice(0, 8) ?? 'conversation';
    downloadCsv(`question-scores-${fileId}.csv`, csvRows);
  }

  return (
    <>
      <Topbar title="Question Scores" />
      <div className="space-y-6">
        <PageHeader
          eyebrow="Reports"
          title="Conversation Question-wise Scores"
          titleGradient
          description="Review conversations in a table and open question-wise form scores in a modal window."
        />

        <Card shadow="sm" className="border-slate-200/90 bg-white">
          <CardBody>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Search Conversation
              </label>
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="External ID, agent, customer, channel"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-primary-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </div>
            {convoListQ.isPending && (
              <p className="mt-3 text-sm text-slate-500">Loading conversations…</p>
            )}
          </CardBody>
        </Card>

        <Card shadow="sm" className="overflow-hidden border-slate-200/90 bg-white">
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full table-auto text-sm">
                <thead className="bg-gradient-to-r from-slate-50 to-slate-100/70">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Conversation
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Channel
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Agent
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Customer
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Final Score
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Received
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(convoListQ.data?.items ?? []).map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 text-slate-800">
                        <p className="font-medium">{c.externalId ?? c.id.slice(0, 8)}</p>
                        <p className="mt-0.5 font-mono text-xs text-slate-400">{c.id}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{c.channel}</td>
                      <td className="px-4 py-3 text-slate-700">{c.agentName ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{c.customerRef ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{c.status}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {c.evaluation?.finalScore != null ? `${c.evaluation.finalScore}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {formatUtcDateTime(c.receivedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <Button size="sm" variant="secondary" onClick={() => openFormModal(c.id)}>
                          Show Form
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {(convoListQ.data?.items ?? []).length === 0 && !convoListQ.isPending && (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                        No conversations found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
              <p className="text-slate-500">
                Page {convoListQ.data?.pagination.page ?? page} of{' '}
                {convoListQ.data?.pagination.totalPages ?? 1}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={(convoListQ.data?.pagination.page ?? page) <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={
                    (convoListQ.data?.pagination.page ?? page) >=
                    (convoListQ.data?.pagination.totalPages ?? 1)
                  }
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>

        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
            <div className="max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Form Question-wise Scores</h3>
                  <p className="text-xs text-slate-500">
                    {convoQ.data?.externalId ??
                      convoQ.data?.id.slice(0, 8) ??
                      'Loading conversation...'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={exportModalCsv}
                    disabled={!touchedRows.length}
                  >
                    Export CSV
                  </Button>
                  <Button variant="secondary" size="sm" onClick={closeModal}>
                    Close
                  </Button>
                </div>
              </div>

              <div className="max-h-[calc(90vh-72px)] overflow-auto p-0">
                {convoQ.isPending && (
                  <p className="px-5 py-10 text-center text-sm text-slate-500">
                    Loading conversation…
                  </p>
                )}

                {!convoQ.isPending && !evaluationId && (
                  <p className="px-5 py-10 text-center text-sm text-slate-500">
                    No evaluation found for this conversation.
                  </p>
                )}

                {evaluationId && evalQ.isPending && (
                  <p className="px-5 py-10 text-center text-sm text-slate-500">
                    Loading evaluation…
                  </p>
                )}

                {evaluationId && evalQ.data && (
                  <div className="overflow-x-auto">
                    <table className="w-full table-auto text-sm">
                      <thead className="bg-gradient-to-r from-slate-50 to-slate-100/70">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Section
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Question
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                            AI
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                            QA
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Verifier / Final
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {touchedRows.map((r) => (
                          <tr key={r.id} className="align-top hover:bg-slate-50/50">
                            <td className="px-4 py-3 text-slate-700">{r.section}</td>
                            <td className="px-4 py-3 text-slate-800">
                              <p className="font-medium">{r.question}</p>
                              <p className="mt-0.5 font-mono text-xs text-slate-400">{r.key}</p>
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              <p>{r.aiText}</p>
                              {r.aiScore != null && (
                                <p className="text-xs text-slate-400">Score: {r.aiScore}</p>
                              )}
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              <p>{r.qaText}</p>
                              {r.qaScore != null && (
                                <p className="text-xs text-slate-400">Score: {r.qaScore}</p>
                              )}
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              <p>{r.vfText}</p>
                              {r.vfScore != null && (
                                <p className="text-xs text-slate-400">Score: {r.vfScore}</p>
                              )}
                            </td>
                          </tr>
                        ))}
                        {touchedRows.length === 0 && (
                          <tr>
                            <td
                              colSpan={5}
                              className="px-4 py-10 text-center text-sm text-slate-500"
                            >
                              No touched questions for this evaluation.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
