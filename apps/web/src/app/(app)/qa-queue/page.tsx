'use client';

import React, { useState, useMemo } from 'react';
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { evaluationsApi, type QueueItem } from '@/lib/evaluations-api';
import { conversationsApi, formsApi } from '@/lib/api';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { Topbar } from '@/components/layout/topbar';
import { PageHeader } from '@/components/layout/page-header';
import { ClipboardList, AlertTriangle, FileText } from 'lucide-react';
import Link from 'next/link';

interface QueueResponse {
  items: QueueItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

// ─── State badge ──────────────────────────────────────────────────────────────

const StateBadge = React.memo(function StateBadge({ state }: { state: string }) {
  const variants = useMemo(
    () => ({
      AI_PENDING: 'primary' as const,
      AI_COMPLETE: 'accent' as const,
      QA_REVIEW: 'warning' as const,
      QA_COMPLETE: 'success' as const,
      VERIFIER_REVIEW: 'accent' as const,
      VERIFIER_COMPLETE: 'success' as const,
      ESCALATED: 'danger' as const,
    }),
    [],
  );
  const variant = variants[state as keyof typeof variants] || 'success';
  return (
    <Badge variant={variant} size="sm">
      {state.replace(/_/g, ' ')}
    </Badge>
  );
});

// ─── Main page ────────────────────────────────────────────────────────────────

export default function QaQueuePage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search, 250);
  const { data, isPending, isFetching, isError } = useQuery<QueueResponse>({
    queryKey: ['qa-queue', page, debouncedSearch],
    queryFn: () => evaluationsApi.listQaQueue(page, 20, debouncedSearch || undefined),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });

  const items: QueueItem[] = data?.items ?? [];
  const total = data?.pagination?.total ?? 0;
  const queueEmpty = !isPending && !isError && items.length === 0;

  const queryClient = useQueryClient();

  // ── Diagnostic queries (only run when queue is empty) ──────────────────────
  const { data: formsData } = useQuery({
    queryKey: ['forms'],
    queryFn: () => formsApi.list({ page: 1, limit: 50 }),
    enabled: queueEmpty,
  });

  const { data: pendingConvData } = useQuery({
    queryKey: ['conversations', 'pending-check'],
    queryFn: () => conversationsApi.list({ status: 'PENDING', limit: 1 }),
    enabled: queueEmpty,
  });

  const publishedForms = useMemo(
    () => (formsData?.items ?? []).filter((f) => f.status === 'PUBLISHED'),
    [formsData?.items],
  );
  const hasPublishedForm = publishedForms.length > 0;
  const pendingCount = pendingConvData?.pagination?.total ?? 0;

  const backfillMutation = useMutation({
    mutationFn: () => conversationsApi.backfillPending(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qa-queue'] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  // Build the most relevant reason the queue is empty
  function EmptyStateDiagnostic() {
    // Still loading diagnostics — show basic empty state
    if (formsData === undefined || pendingConvData === undefined) {
      return (
        <div className="flex flex-col items-center py-16 text-center">
          <ClipboardList className="mb-3 h-10 w-10 text-gray-300" />
          <p className="text-gray-700 font-medium">Queue is empty</p>
          <p className="mt-1 text-sm text-gray-500">Loading diagnostics…</p>
        </div>
      );
    }

    // Case 1: No published form — nothing can ever be evaluated
    if (!hasPublishedForm) {
      return (
        <div className="p-8 flex flex-col items-center text-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-orange-100">
            <FileText className="h-7 w-7 text-orange-500" />
          </div>
          <div>
            <p className="text-base font-semibold text-gray-900">No published QA form</p>
            <p className="mt-1 max-w-sm text-sm text-gray-500">
              Conversations cannot be evaluated without a published QA form. Create and publish a
              form, then re-upload your conversations.
            </p>
          </div>
          <div className="flex gap-3 flex-wrap justify-center">
            <Link href="/forms">
              <Button variant="primary" size="sm">
                Go to Forms
              </Button>
            </Link>
            <Link href="/conversations">
              <Button variant="secondary" size="sm">
                View Conversations
              </Button>
            </Link>
          </div>
          {pendingCount > 0 && (
            <div className="mt-2 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-700 max-w-sm">
              <AlertTriangle className="inline h-4 w-4 mr-1 -mt-0.5" />
              <strong>{pendingCount}</strong> conversation{pendingCount !== 1 ? 's are' : ' is'}{' '}
              currently stuck in <strong>PENDING</strong> state. After publishing a form, re-upload
              them to trigger evaluation.
            </div>
          )}
        </div>
      );
    }

    // Case 2: Form exists but conversations are stuck in PENDING (uploaded before form was published)
    if (pendingCount > 0) {
      return (
        <div className="p-8 flex flex-col items-center text-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-yellow-100">
            <AlertTriangle className="h-7 w-7 text-yellow-500" />
          </div>
          <div>
            <p className="text-base font-semibold text-gray-900">
              {pendingCount} conversation{pendingCount !== 1 ? 's' : ''} waiting to be evaluated
            </p>
            <p className="mt-1 max-w-sm text-sm text-gray-500">
              These conversations were uploaded before a QA form was published so no evaluation was
              created. Click below to route them into this queue now — no re-upload needed.
            </p>
          </div>
          {backfillMutation.isSuccess && (
            <p className="text-green-700 font-medium text-sm">
              ✓ {backfillMutation.data?.processed} conversation
              {backfillMutation.data?.processed !== 1 ? 's' : ''} sent to QA queue.
            </p>
          )}
          {backfillMutation.isError && (
            <p className="text-red-700 font-medium text-sm">Failed — please try again.</p>
          )}
          <div className="flex gap-3 flex-wrap justify-center">
            <Button
              variant="primary"
              size="sm"
              isLoading={backfillMutation.isPending}
              onClick={() => backfillMutation.mutate()}
            >
              Evaluate Pending Conversations
            </Button>
            <Link href="/conversations">
              <Button variant="secondary" size="sm">
                View Conversations
              </Button>
            </Link>
          </div>
        </div>
      );
    }

    // Case 3: Everything is set up — queue is genuinely empty
    return (
      <div className="flex flex-col items-center py-16 text-center">
        <ClipboardList className="mb-3 h-10 w-10 text-gray-300" />
        <p className="text-gray-700 font-medium">Queue is empty</p>
        <p className="mt-1 text-sm text-gray-500">
          New conversations will appear here once uploaded and evaluated.
        </p>
        <Link href="/conversations">
          <Button className="mt-4" variant="secondary">
            Go to Conversations
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <>
      <Topbar title="QA Queue" />
      <div className="space-y-6">
        <PageHeader
          eyebrow="Workflow"
          title="QA queue"
          titleGradient
          description={
            total > 0
              ? `${total} item${total !== 1 ? 's' : ''} awaiting your review.`
              : 'Nothing waiting — new work lands here after AI scoring.'
          }
          aside={
            total > 0 ? (
              <div className="surface-glass rounded-full px-4 py-2">
                <Badge variant="primary" size="md">
                  {total} pending
                </Badge>
              </div>
            ) : undefined
          }
        />

        <Card shadow="sm" className="border-slate-200/90 bg-white/90 backdrop-blur-sm">
          <CardBody className="space-y-4">
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by external ID, channel, agent, or customer"
              className="w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 transition-all placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
            {isPending && items.length === 0 && (
              <div className="py-12 text-center text-sm text-slate-600">Loading queue…</div>
            )}
            {isError && <Alert variant="danger">Failed to load QA queue.</Alert>}
            {!isPending && !isError && items.length === 0 && <EmptyStateDiagnostic />}
            {items.length > 0 && (
              <div className="overflow-x-auto -mx-5 -mb-4">
                {isFetching && (
                  <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-2 text-xs font-medium text-slate-500">
                    Updating queue…
                  </div>
                )}
                <table className="min-w-full divide-y divide-slate-100">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                        Conversation
                      </th>
                      <th className="px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                        Channel
                      </th>
                      <th className="px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                        Agent
                      </th>
                      <th className="px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                        AI Score
                      </th>
                      <th className="px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                        State
                      </th>
                      <th className="px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                        Received
                      </th>
                      <th className="px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3 text-sm text-slate-700">
                          <div className="space-y-1">
                            <div className="font-mono whitespace-nowrap text-xs">
                              {item.evaluation.conversation.externalId ??
                                item.evaluationId.slice(0, 8)}
                            </div>
                            {item.evaluation.verifierRejectReason && (
                              <div className="max-w-[280px] rounded-lg border border-warning-200 bg-warning-50 px-2.5 py-2 text-xs text-warning-800">
                                <div className="font-semibold">Rejected by verifier</div>
                                <div className="mt-0.5 line-clamp-3">
                                  {item.evaluation.verifierRejectReason}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-700 whitespace-nowrap">
                          {item.evaluation.conversation.channel}
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-700 max-w-[140px] truncate">
                          {item.evaluation.conversation.agentName ?? '—'}
                        </td>
                        <td className="px-5 py-3">
                          {item.evaluation.aiScore !== null ? (
                            <span className="text-sm font-semibold text-slate-900">
                              {item.evaluation.aiScore.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-sm text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <div className="space-y-1">
                            <StateBadge state={item.evaluation.workflowState} />
                            {item.evaluation.verifierRejectedAt && (
                              <div className="text-xs text-warning-700 whitespace-nowrap">
                                Returned{' '}
                                {new Date(item.evaluation.verifierRejectedAt).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-600 whitespace-nowrap">
                          {new Date(item.evaluation.conversation.receivedAt).toLocaleDateString()}
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          <Link href={`/qa-queue/${item.evaluationId}`}>
                            <Button size="sm" variant="secondary">
                              Review
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data?.pagination && data.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                <p className="text-sm text-slate-600">
                  {(page - 1) * data.pagination.limit + 1}–
                  {Math.min(page * data.pagination.limit, data.pagination.total)} of{' '}
                  {data.pagination.total}
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
                    disabled={page >= data.pagination.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
