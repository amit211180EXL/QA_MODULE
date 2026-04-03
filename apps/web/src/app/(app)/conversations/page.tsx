'use client';

import React, { useState, useRef, useMemo } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { conversationsApi, formsApi, ConversationListItem } from '@/lib/api';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Topbar } from '@/components/layout/topbar';
import { Upload, RefreshCw, AlertTriangle } from 'lucide-react';

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-600',
  EVALUATING: 'bg-blue-100 text-blue-700',
  QA_REVIEW: 'bg-amber-100 text-amber-700',
  VERIFIER_REVIEW: 'bg-violet-100 text-violet-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-red-100 text-red-600',
};

const StatusBadge = React.memo(function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-2xs font-semibold ${STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-500'}`}
    >
      {status.replace('_', ' ')}
    </span>
  );
});

// ─── Score cell ───────────────────────────────────────────────────────────────

const ScoreCell = React.memo(function ScoreCell({ evaluation }: { evaluation: ConversationListItem['evaluation'] }) {
  if (!evaluation) return <span className="text-slate-300 text-sm font-semibold">—</span>;
  const score =
    evaluation.finalScore ?? evaluation.verifierScore ?? evaluation.qaScore ?? evaluation.aiScore;
  if (score === null) return <span className="text-slate-300 text-sm font-semibold">—</span>;
  const label =
    evaluation.finalScore !== null ? 'Final'
    : evaluation.verifierScore !== null ? 'Verifier'
    : evaluation.qaScore !== null ? 'QA'
    : 'AI';
  const pass = evaluation.passFail;
  return (
    <div className="flex items-center gap-2">
      <span
        className={`text-sm font-bold tabular-nums ${
          pass === null ? 'text-slate-700' : pass ? 'text-emerald-600' : 'text-red-500'
        }`}
      >
        {score.toFixed(1)}%
      </span>
      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
        {label}
      </span>
    </div>
  );
});

// ─── JSON upload modal ────────────────────────────────────────────────────────

const UploadModal = React.memo(function UploadModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [channel, setChannel] = useState('CHAT');
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<unknown[] | null>(null);

  const uploadMutation = useMutation({
    mutationFn: (rows: unknown[]) =>
      conversationsApi.upload({
        channel,
        conversations: rows as Parameters<typeof conversationsApi.upload>[0]['conversations'],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      onClose();
    },
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setParseError(null);
    setParsed(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target?.result as string);
        const rows = Array.isArray(raw) ? raw : [raw];
        setParsed(rows);
      } catch {
        setParseError('Invalid JSON file — could not parse.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-6 py-4">
          <h3 className="text-base font-bold text-slate-900">Upload Conversations</h3>
          <p className="mt-0.5 text-xs text-slate-500">JSON file with an array of conversation objects</p>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Channel</label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {['CHAT', 'EMAIL', 'CALL', 'SOCIAL'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div
            className="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-slate-200 p-8 text-center transition-colors hover:border-blue-400 hover:bg-blue-50/50"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="mb-2 h-8 w-8 text-slate-300" />
            <p className="text-sm font-semibold text-slate-700">
              {fileName ?? 'Click to select a JSON file'}
            </p>
            <p className="mt-1 text-xs text-slate-400">Array of conversation objects, max 500</p>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleFile}
            />
          </div>

          {parseError && <Alert variant="danger">{parseError}</Alert>}
          {parsed && (
            <Alert variant="success">
              {parsed.length} conversation{parsed.length !== 1 ? 's' : ''} ready to upload
            </Alert>
          )}
          {uploadMutation.isError && (
            <Alert variant="danger">Upload failed — please try again.</Alert>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!parsed || !parsed.length}
            isLoading={uploadMutation.isPending}
            onClick={() => parsed && uploadMutation.mutate(parsed)}
          >
            Upload
          </Button>
        </div>
      </div>
    </div>
  );
});

// ─── Main page ────────────────────────────────────────────────────────────────

const STATUSES = [
  '',
  'PENDING',
  'EVALUATING',
  'QA_REVIEW',
  'VERIFIER_REVIEW',
  'COMPLETED',
  'FAILED',
];

export default function ConversationsPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showUpload, setShowUpload] = useState(false);
  const queryClient = useQueryClient();
  const debouncedSearch = useDebouncedValue(search, 250);

  const { data, isPending, isFetching, isError } = useQuery({
    queryKey: ['conversations', statusFilter, debouncedSearch, page],
    queryFn: () =>
      conversationsApi.list({
        status: statusFilter || undefined,
        search: debouncedSearch || undefined,
        page,
        limit: 20,
      }),
    placeholderData: keepPreviousData,
  });

  const items: ConversationListItem[] = data?.items ?? [];
  const pagination = data?.pagination;

  // ── Detect conversations stuck in PENDING (no published form at upload time) ──
  const { data: pendingData } = useQuery({
    queryKey: ['conversations', 'pending-check'],
    queryFn: () => conversationsApi.list({ status: 'PENDING', limit: 1 }),
    staleTime: 30_000,
  });
  const { data: formsData } = useQuery({
    queryKey: ['forms'],
    queryFn: () => formsApi.list({ page: 1, limit: 50 }),
    staleTime: 30_000,
  });
  const pendingCount = pendingData?.pagination?.total ?? 0;
  const hasPublishedForm = (formsData?.items ?? []).some((f) => f.status === 'PUBLISHED');

  const backfillMutation = useMutation({
    mutationFn: () => conversationsApi.backfillPending(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['qa-queue'] });
    },
  });

  return (
    <>
      <Topbar title="Conversations" />
      {showUpload && <UploadModal onClose={() => setShowUpload(false)} />}

      {/* Page header */}
      <div className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.05)]">
        <div className="flex items-center justify-between bg-gradient-to-r from-slate-50 to-white px-5 py-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Conversations</h1>
            <p className="text-sm text-slate-500">Upload and track your QA conversation evaluations</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ['conversations'] })}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-50"
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <Button onClick={() => setShowUpload(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Upload
            </Button>
          </div>
        </div>
      </div>

      {/* Warning: no published form */}
      {pendingCount > 0 && !hasPublishedForm && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-orange-800">
              {pendingCount} conversation{pendingCount !== 1 ? 's' : ''} stuck in PENDING — no published QA form
            </p>
            <p className="mt-0.5 text-orange-700">
              Publish a form first, then click <strong>Evaluate Pending</strong>.
            </p>
            <div className="mt-2">
              <Link href="/forms">
                <Button size="sm" variant="primary">Go to Forms</Button>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Warning: backfill available */}
      {pendingCount > 0 && hasPublishedForm && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-amber-800">
              {pendingCount} conversation{pendingCount !== 1 ? 's' : ''} waiting to be evaluated
            </p>
            <p className="mt-0.5 text-amber-700">
              Uploaded before a QA form was published. Route them into the QA queue now.
            </p>
            {backfillMutation.isSuccess && (
              <p className="mt-1.5 font-semibold text-emerald-700">
                ✓ {backfillMutation.data?.processed} conversation{backfillMutation.data?.processed !== 1 ? 's' : ''} sent to QA queue.
              </p>
            )}
            {backfillMutation.isError && (
              <p className="mt-1.5 font-semibold text-red-600">Failed — please try again.</p>
            )}
            <div className="mt-2">
              <Button size="sm" isLoading={backfillMutation.isPending} onClick={() => backfillMutation.mutate()}>
                Evaluate Pending Conversations
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="mb-4 space-y-2">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by external ID, channel, agent, or customer…"
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                statusFilter === s
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.05)]">
        {isPending && items.length === 0 && (
          <div className="flex items-center justify-center py-16 text-sm text-slate-400">
            <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-blue-500" />
            Loading…
          </div>
        )}
        {isError && (
          <div className="p-6">
            <Alert variant="danger">Failed to load conversations.</Alert>
          </div>
        )}
        {!isPending && !isError && items.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <Upload className="mb-3 h-10 w-10 text-slate-200" />
            <p className="text-sm font-medium text-slate-500">No conversations yet</p>
            <Button className="mt-4" onClick={() => setShowUpload(true)}>
              Upload your first batch
            </Button>
          </div>
        )}
        {items.length > 0 && (
          <>
            {isFetching && (
              <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-2 text-xs font-medium text-slate-500">
                Updating conversations…
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80">
                    {['External ID', 'Channel', 'Agent', 'Customer', 'Status', 'Score', 'Received'].map((h) => (
                      <th
                        key={h}
                        className="whitespace-nowrap px-4 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {items.map((c) => (
                    <tr key={c.id} className="group transition-colors hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <Link
                          href={`/conversations/${c.id}`}
                          className="font-mono text-sm font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {c.externalId ?? c.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-2xs font-semibold text-slate-600">
                          {c.channel}
                        </span>
                      </td>
                      <td className="max-w-[140px] truncate px-4 py-3 text-sm text-slate-700">
                        {c.agentName ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td className="max-w-[120px] truncate px-4 py-3 text-sm text-slate-600">
                        {c.customerRef ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-4 py-3">
                        <ScoreCell evaluation={c.evaluation} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-400">
                        {new Date(c.receivedAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
                <p className="text-sm text-slate-500">
                  {(page - 1) * pagination.limit + 1}–
                  {Math.min(page * pagination.limit, pagination.total)} of {pagination.total}
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button variant="secondary" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
