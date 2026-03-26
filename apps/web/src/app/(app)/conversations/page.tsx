'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { conversationsApi, ConversationListItem } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Upload, RefreshCw } from 'lucide-react';

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-700',
  EVALUATING: 'bg-blue-100 text-blue-700',
  QA_REVIEW: 'bg-yellow-100 text-yellow-700',
  VERIFIER_REVIEW: 'bg-purple-100 text-purple-700',
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

// ─── Score cell ───────────────────────────────────────────────────────────────

function ScoreCell({ score, passFail }: { score: number | null; passFail: boolean | null }) {
  if (score === null) return <span className="text-gray-400 text-sm">—</span>;
  return (
    <span className={`text-sm font-medium ${passFail ? 'text-green-600' : 'text-red-600'}`}>
      {score.toFixed(1)}%
    </span>
  );
}

// ─── JSON upload modal ────────────────────────────────────────────────────────

function UploadModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [channel, setChannel] = useState('CHAT');
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<unknown[] | null>(null);

  const uploadMutation = useMutation({
    mutationFn: (rows: unknown[]) =>
      conversationsApi.upload({ channel, conversations: rows as Parameters<typeof conversationsApi.upload>[0]['conversations'] }),
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">Upload conversations</h3>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Channel</label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              {['CHAT', 'EMAIL', 'CALL', 'SOCIAL'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div
            className="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-gray-300 p-8 text-center hover:border-primary-400 hover:bg-primary-50 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="mb-2 h-8 w-8 text-gray-400" />
            <p className="text-sm font-medium text-gray-700">{fileName ?? 'Click to select a JSON file'}</p>
            <p className="mt-1 text-xs text-gray-500">Array of conversation objects, max 500</p>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFile} />
          </div>

          {parseError && <Alert variant="error">{parseError}</Alert>}
          {parsed && (
            <Alert variant="success">{parsed.length} conversation{parsed.length !== 1 ? 's' : ''} ready to upload</Alert>
          )}
          {uploadMutation.isError && <Alert variant="error">Upload failed — please try again.</Alert>}
        </div>

        <div className="mt-6 flex justify-end gap-2">
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
}

// ─── Main page ────────────────────────────────────────────────────────────────

const STATUSES = ['', 'PENDING', 'EVALUATING', 'QA_REVIEW', 'VERIFIER_REVIEW', 'COMPLETED', 'FAILED'];

export default function ConversationsPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showUpload, setShowUpload] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['conversations', statusFilter, page],
    queryFn: () =>
      conversationsApi.list({ status: statusFilter || undefined, page, limit: 20 }),
  });

  const items: ConversationListItem[] = data?.items ?? [];
  const pagination = data?.pagination;

  return (
    <>
      {showUpload && <UploadModal onClose={() => setShowUpload(false)} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Conversations</h1>
          <p className="text-sm text-gray-500">Upload and track conversation evaluations</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['conversations'] })}
            className="rounded-lg border border-gray-200 p-2 hover:bg-gray-100"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4 text-gray-500" />
          </button>
          <Button onClick={() => setShowUpload(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Upload
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setPage(1); }}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === s
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-hidden">
        {isLoading && (
          <div className="py-16 text-center text-sm text-gray-500">Loading…</div>
        )}
        {isError && (
          <div className="p-6"><Alert variant="error">Failed to load conversations.</Alert></div>
        )}
        {!isLoading && !isError && items.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <Upload className="mb-3 h-10 w-10 text-gray-300" />
            <p className="text-gray-500 text-sm">No conversations yet</p>
            <Button className="mt-4" onClick={() => setShowUpload(true)}>Upload your first batch</Button>
          </div>
        )}
        {!isLoading && items.length > 0 && (
          <>
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  {['External ID', 'Channel', 'Agent', 'Customer', 'Status', 'Score', 'Received'].map((col) => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-600 font-mono">{c.externalId ?? c.id.slice(0, 8)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{c.channel}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{c.agentName ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{c.customerRef ?? '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-3">
                      <ScoreCell score={c.evaluation?.finalScore ?? null} passFail={c.evaluation?.passFail ?? null} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(c.receivedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
                <p className="text-sm text-gray-500">
                  {(page - 1) * pagination.limit + 1}–{Math.min(page * pagination.limit, pagination.total)} of {pagination.total}
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
