'use client';

import React, { useState, useMemo } from 'react';
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { evaluationsApi, type QueueItem } from '@/lib/evaluations-api';
import { conversationsApi, formsApi, usersApi } from '@/lib/api';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useAuth } from '@/context/auth-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { Topbar } from '@/components/layout/topbar';
import { PageHeader } from '@/components/layout/page-header';
import {
  ClipboardList,
  AlertTriangle,
  FileText,
  Shuffle,
  Search,
  Users,
  CircleCheckBig,
  Clock3,
} from 'lucide-react';
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
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const queryClient = useQueryClient();

  const { data, isPending, isFetching, isError } = useQuery<QueueResponse>({
    queryKey: ['qa-queue', page, debouncedSearch],
    queryFn: () => evaluationsApi.listQaQueue(page, 20, debouncedSearch || undefined),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });

  // Load eligible QA users for assignment (admin only)
  const { data: usersData } = useQuery({
    queryKey: ['users', 'qa-eligible'],
    queryFn: () => usersApi.list({ role: 'QA', status: 'ACTIVE', limit: 100 }),
    enabled: isAdmin,
  });
  const { data: adminUsersData } = useQuery({
    queryKey: ['users', 'admin-eligible'],
    queryFn: () => usersApi.list({ role: 'ADMIN', status: 'ACTIVE', limit: 100 }),
    enabled: isAdmin,
  });
  const eligibleUsers = useMemo(() => {
    const qaUsers = usersData?.items ?? [];
    const adminUsers = adminUsersData?.items ?? [];
    const seen = new Set<string>();
    return [...qaUsers, ...adminUsers].filter((u) => {
      if (seen.has(u.id)) return false;
      seen.add(u.id);
      return true;
    });
  }, [usersData, adminUsersData]);

  // Round-robin mutation
  const roundRobinMutation = useMutation({
    mutationFn: () => evaluationsApi.roundRobinAssign('QA_QUEUE'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['qa-queue'] }),
  });

  // Manual assign mutation
  const assignMutation = useMutation({
    mutationFn: ({ evaluationId, userId }: { evaluationId: string; userId: string }) =>
      evaluationsApi.manualAssign(evaluationId, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['qa-queue'] }),
  });

  // Reassign mutation
  const reassignMutation = useMutation({
    mutationFn: ({ evaluationId, newUserId }: { evaluationId: string; newUserId: string }) =>
      evaluationsApi.reassign(evaluationId, newUserId, 'Admin reassignment'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['qa-queue'] }),
  });

  const items: QueueItem[] = data?.items ?? [];
  const total = data?.pagination?.total ?? 0;
  const queueEmpty = !isPending && !isError && items.length === 0;
  const unassignedCount = items.filter((i) => !i.assignedTo).length;

  const queryClient2 = queryClient; // alias to avoid shadowing

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
      queryClient2.invalidateQueries({ queryKey: ['qa-queue'] });
      queryClient2.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  // Build the most relevant reason the queue is empty
  function EmptyStateDiagnostic() {
    // Still loading diagnostics — show basic empty state
    if (formsData === undefined || pendingConvData === undefined) {
      return (
        <div className="flex flex-col items-center py-16 text-center">
          <ClipboardList className="mb-3 h-10 w-10 text-slate-300" />
          <p className="font-medium text-slate-700">Queue is empty</p>
          <p className="mt-1 text-sm text-slate-500">Loading diagnostics…</p>
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
            <p className="text-base font-semibold text-slate-900">No published QA form</p>
            <p className="mt-1 max-w-sm text-sm text-slate-500">
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
            <p className="text-base font-semibold text-slate-900">
              {pendingCount} conversation{pendingCount !== 1 ? 's' : ''} waiting to be evaluated
            </p>
            <p className="mt-1 max-w-sm text-sm text-slate-500">
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
        <ClipboardList className="mb-3 h-10 w-10 text-slate-300" />
        <p className="font-medium text-slate-700">Queue is empty</p>
        <p className="mt-1 text-sm text-slate-500">
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
            <div className="flex items-center gap-3">
              {isAdmin && unassignedCount > 0 && (
                <Button
                  variant="primary"
                  size="sm"
                  isLoading={roundRobinMutation.isPending}
                  onClick={() => roundRobinMutation.mutate()}
                >
                  <Shuffle className="mr-1.5 h-3.5 w-3.5" />
                  Auto-assign ({unassignedCount})
                </Button>
              )}
              {roundRobinMutation.isSuccess && (
                <Badge variant="success" size="sm">
                  Assigned{' '}
                  {(roundRobinMutation.data as any)?.data?.assigned ??
                    (roundRobinMutation.data as any)?.assigned ??
                    0}
                </Badge>
              )}
              {total > 0 && (
                <div className="surface-glass rounded-full px-4 py-2">
                  <Badge variant="primary" size="md">
                    {total} pending
                  </Badge>
                </div>
              )}
            </div>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Users className="h-3.5 w-3.5 text-primary-600" />
              Loaded
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-900">{items.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Clock3 className="h-3.5 w-3.5 text-amber-600" />
              Unassigned
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-900">{unassignedCount}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <CircleCheckBig className="h-3.5 w-3.5 text-emerald-600" />
              Assigned
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {Math.max(items.length - unassignedCount, 0)}
            </p>
          </div>
        </div>

        <Card
          shadow="sm"
          className="overflow-hidden border-slate-200/90 bg-white/95 shadow-[0_16px_38px_rgba(15,23,42,0.08)] backdrop-blur-sm"
        >
          <CardBody className="space-y-4">
            <div className="border-b border-slate-100 bg-gradient-to-r from-white to-slate-50 px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Queue Items
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search by external ID, channel, agent, or customer"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-9 py-2.5 text-sm text-slate-900 transition-all placeholder:text-slate-500 focus:bg-white focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </div>
            {isPending && items.length === 0 && (
              <div className="py-12 text-center text-sm text-slate-600">Loading queue…</div>
            )}
            {isError && <Alert variant="danger">Failed to load QA queue.</Alert>}
            {!isPending && !isError && items.length === 0 && <EmptyStateDiagnostic />}
            {items.length > 0 && (
              <div className="-mx-5 -mb-4">
                {isFetching && (
                  <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-2 text-xs font-medium text-slate-500">
                    Updating queue…
                  </div>
                )}

                {/* Mobile / tablet cards */}
                <div className="space-y-3 px-5 pb-4 lg:hidden">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-mono text-xs font-semibold text-primary-700">
                            {item.evaluation.conversation.externalId ??
                              item.evaluationId.slice(0, 8)}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {item.evaluation.conversation.channel} ·{' '}
                            {item.evaluation.conversation.agentName ?? 'Unknown agent'}
                          </p>
                        </div>
                        <StateBadge state={item.evaluation.workflowState} />
                      </div>

                      <div className="mt-3 flex items-center justify-between text-xs">
                        <div className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-2.5 py-1 font-bold text-primary-700">
                          {item.evaluation.aiScore !== null
                            ? `${item.evaluation.aiScore.toFixed(1)}%`
                            : '—'}
                          <span className="text-[10px] font-semibold uppercase text-primary-500">
                            AI
                          </span>
                        </div>
                        <span className="text-slate-500">
                          {new Date(item.evaluation.conversation.receivedAt).toLocaleDateString()}
                        </span>
                      </div>

                      {item.evaluation.verifierRejectReason && (
                        <div className="mt-3 rounded-lg border border-warning-200 bg-warning-50 px-2.5 py-2 text-xs text-warning-800">
                          <div className="font-semibold">Rejected by verifier</div>
                          <div className="mt-0.5 line-clamp-3">
                            {item.evaluation.verifierRejectReason}
                          </div>
                        </div>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Link href={`/qa-queue/${item.evaluationId}`}>
                          <Button size="sm" variant="secondary">
                            Review
                          </Button>
                        </Link>

                        {isAdmin && (
                          <select
                            className={`min-w-[120px] rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-1 ${
                              item.assignedTo
                                ? 'border border-emerald-300 bg-emerald-50 text-emerald-800 focus:bg-white focus:border-emerald-500 focus:ring-emerald-500/20'
                                : 'border border-slate-200 bg-slate-50 text-slate-700 focus:bg-white focus:border-primary-500 focus:ring-primary-500/20'
                            }`}
                            defaultValue=""
                            onChange={(e) => {
                              if (e.target.value) {
                                if (item.assignedTo) {
                                  reassignMutation.mutate({
                                    evaluationId: item.evaluationId,
                                    newUserId: e.target.value,
                                  });
                                } else {
                                  assignMutation.mutate({
                                    evaluationId: item.evaluationId,
                                    userId: e.target.value,
                                  });
                                }
                                e.target.value = '';
                              }
                            }}
                          >
                            <option value="">
                              {item.assignedTo ? 'Reassign to' : 'Assign to'}
                            </option>
                            {eligibleUsers
                              .filter((u) => (item.assignedTo ? u.id !== item.assignedTo : true))
                              .map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name} ({u.role})
                                </option>
                              ))}
                          </select>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop table */}
                <div className="hidden px-0 pb-4 lg:block">
                  <div className="overflow-x-auto rounded-lg border border-slate-200/80 bg-white [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300/80 [&::-webkit-scrollbar-track]:bg-transparent">
                    <table className="w-full min-w-[1200px] table-auto border-separate border-spacing-0">
                      <thead className="bg-gradient-to-r from-slate-50 to-slate-100/70">
                        <tr>
                          <th className="px-5 py-3.5 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                            Conversation
                          </th>
                          <th className="px-5 py-3.5 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                            Channel
                          </th>
                          <th className="px-5 py-3.5 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                            Agent
                          </th>
                          <th className="px-5 py-3.5 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                            AI Score
                          </th>
                          <th className="px-5 py-3.5 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                            State
                          </th>
                          <th className="px-5 py-3.5 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                            Received
                          </th>
                          <th className="w-[120px] px-5 py-3.5 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                            Action
                          </th>
                          {isAdmin && (
                            <th className="w-[320px] pl-5 pr-0 py-3.5 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                              Assign
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="[&>tr]:border-b [&>tr]:border-slate-100">
                        {items.map((item) => (
                          <tr
                            key={item.id}
                            className="even:bg-slate-50/40 hover:bg-primary-50/40 transition-colors"
                          >
                            <td className="px-5 py-3 text-sm text-slate-700">
                              <div className="space-y-1">
                                <div className="font-mono truncate text-xs font-semibold text-primary-700">
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
                            <td className="px-5 py-3 whitespace-nowrap">
                              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-2xs font-semibold text-slate-600">
                                {item.evaluation.conversation.channel}
                              </span>
                            </td>
                            <td className="max-w-[140px] truncate px-5 py-3 text-sm text-slate-700">
                              {item.evaluation.conversation.agentName ?? '—'}
                            </td>
                            <td className="px-5 py-3">
                              {item.evaluation.aiScore !== null ? (
                                <div className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-bold text-primary-700">
                                  {item.evaluation.aiScore.toFixed(1)}%
                                  <span className="text-[10px] font-semibold uppercase text-primary-500">
                                    AI
                                  </span>
                                </div>
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
                                    {new Date(
                                      item.evaluation.verifierRejectedAt,
                                    ).toLocaleDateString()}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-600">
                              {new Date(
                                item.evaluation.conversation.receivedAt,
                              ).toLocaleDateString()}
                            </td>
                            <td className="px-5 py-3 align-middle whitespace-nowrap">
                              <Link href={`/qa-queue/${item.evaluationId}`}>
                                <Button size="sm" variant="secondary">
                                  Review
                                </Button>
                              </Link>
                            </td>
                            {isAdmin && (
                              <td className="min-w-[300px] pl-5 pr-0 py-3 align-middle">
                                {item.assignedTo ? (
                                  <div className="flex w-full flex-col items-start gap-1.5">
                                    <select
                                      className="h-8 w-[200px] rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-800 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/20"
                                      defaultValue=""
                                      onChange={(e) => {
                                        if (e.target.value) {
                                          reassignMutation.mutate({
                                            evaluationId: item.evaluationId,
                                            newUserId: e.target.value,
                                          });
                                          e.target.value = '';
                                        }
                                      }}
                                    >
                                      <option value="">Reassign to</option>
                                      {eligibleUsers
                                        .filter((u) => u.id !== item.assignedTo)
                                        .map((u) => (
                                          <option key={u.id} value={u.id}>
                                            {u.name} ({u.role})
                                          </option>
                                        ))}
                                    </select>
                                  </div>
                                ) : (
                                  <select
                                    className="h-8 w-[200px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-700 focus:bg-white focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/20"
                                    defaultValue=""
                                    onChange={(e) => {
                                      if (e.target.value) {
                                        assignMutation.mutate({
                                          evaluationId: item.evaluationId,
                                          userId: e.target.value,
                                        });
                                        e.target.value = '';
                                      }
                                    }}
                                  >
                                    <option value="">Assign to</option>
                                    {eligibleUsers.map((u) => (
                                      <option key={u.id} value={u.id}>
                                        {u.name} ({u.role})
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
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
