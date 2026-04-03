'use client';

import React, { useState, useRef, useMemo } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { conversationsApi, formsApi, ConversationListItem } from '@/lib/api';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Topbar } from '@/components/layout/topbar';
import { PageHeader } from '@/components/layout/page-header';
import {
  Upload,
  RefreshCw,
  AlertTriangle,
  Search,
  Inbox,
  Clock3,
  CircleCheckBig,
} from 'lucide-react';

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

const ScoreCell = React.memo(function ScoreCell({
  evaluation,
}: {
  evaluation: ConversationListItem['evaluation'];
}) {
  if (!evaluation) return <span className="text-slate-300 text-sm font-semibold">—</span>;
  const score =
    evaluation.finalScore ?? evaluation.verifierScore ?? evaluation.qaScore ?? evaluation.aiScore;
  if (score === null) return <span className="text-slate-300 text-sm font-semibold">—</span>;
  const label =
    evaluation.finalScore !== null
      ? 'Final'
      : evaluation.verifierScore !== null
        ? 'Verifier'
        : evaluation.qaScore !== null
          ? 'QA'
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
          <p className="mt-0.5 text-xs text-slate-500">
            JSON file with an array of conversation objects
          </p>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Channel
            </label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {['CHAT', 'EMAIL', 'CALL', 'SOCIAL'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
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
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
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
  const statusCounts = useMemo(() => {
    return items.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    }, {});
  }, [items]);

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
      <div className="mb-5 overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50/60 to-primary-50/30 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
        <PageHeader
          eyebrow="Ingest"
          title="Conversations"
          titleGradient
          description="Upload batches, track QA workflow progress, and jump into transcript details fast."
          aside={
            <>
              <Button
                variant="secondary"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['conversations'] })}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
              <Button onClick={() => setShowUpload(true)}>
                <Upload className="mr-2 h-4 w-4" />
                Upload Batch
              </Button>
            </>
          }
        />

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white/80 p-3 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Inbox className="h-3.5 w-3.5 text-primary-600" />
              Loaded
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-900">{items.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white/80 p-3 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Clock3 className="h-3.5 w-3.5 text-amber-600" />
              In Review
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {(statusCounts.QA_REVIEW ?? 0) + (statusCounts.VERIFIER_REVIEW ?? 0)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white/80 p-3 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <CircleCheckBig className="h-3.5 w-3.5 text-emerald-600" />
              Completed
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-900">{statusCounts.COMPLETED ?? 0}</p>
          </div>
        </div>
      </div>

      {/* Warning: no published form */}
      {pendingCount > 0 && !hasPublishedForm && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-orange-800">
              {pendingCount} conversation{pendingCount !== 1 ? 's' : ''} stuck in PENDING — no
              published QA form
            </p>
            <p className="mt-0.5 text-orange-700">
              Publish a form first, then click <strong>Evaluate Pending</strong>.
            </p>
            <div className="mt-2">
              <Link href="/forms">
                <Button size="sm" variant="primary">
                  Go to Forms
                </Button>
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
                ✓ {backfillMutation.data?.processed} conversation
                {backfillMutation.data?.processed !== 1 ? 's' : ''} sent to QA queue.
              </p>
            )}
            {backfillMutation.isError && (
              <p className="mt-1.5 font-semibold text-red-600">Failed — please try again.</p>
            )}
            <div className="mt-2">
              <Button
                size="sm"
                isLoading={backfillMutation.isPending}
                onClick={() => backfillMutation.mutate()}
              >
                Evaluate Pending Conversations
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_8px_22px_rgba(15,23,42,0.06)]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by external ID, channel, agent, or customer"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-9 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/25"
          />
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto rounded-2xl bg-slate-100/80 p-1.5">
          {STATUSES.map((s) => {
            const active = statusFilter === s;
            const count = s ? (statusCounts[s] ?? 0) : items.length;
            return (
              <button
                key={s}
                onClick={() => {
                  setStatusFilter(s);
                  setPage(1);
                }}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                  active
                    ? 'bg-white text-primary-700 shadow-sm ring-1 ring-primary-200'
                    : 'bg-transparent text-slate-600 hover:bg-white/80 hover:text-slate-800'
                }`}
              >
                <span>{s || 'All'}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    active ? 'bg-primary-100 text-primary-700' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_38px_rgba(15,23,42,0.08)]">
        <div className="border-b border-slate-100 bg-gradient-to-r from-white to-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Conversation Stream
        </div>
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
                    {[
                      'External ID',
                      'Channel',
                      'Agent',
                      'Customer',
                      'Status',
                      'Score',
                      'Received',
                    ].map((h) => (
                      <th
                        key={h}
                        className="whitespace-nowrap px-4 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((c) => (
                    <tr key={c.id} className="group transition-colors hover:bg-primary-50/30">
                      <td className="px-4 py-3">
                        <Link
                          href={`/conversations/${c.id}`}
                          className="font-mono text-sm font-semibold text-primary-700 hover:text-primary-900 hover:underline"
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
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page >= pagination.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
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
