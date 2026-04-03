'use client';

import React, { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Topbar } from '@/components/layout/topbar';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/page-header';
import { ShieldCheck, Search, CircleCheckBig, Clock3, Layers } from 'lucide-react';
import Link from 'next/link';
import { evaluationsApi, type QueueItem } from '@/lib/evaluations-api';

interface QueueResponse {
  items: QueueItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function StateBadge({ state }: { state: string }) {
  const variants: Record<string, 'primary' | 'accent' | 'warning' | 'success'> = {
    QA_COMPLETED: 'primary',
    VERIFIER_PENDING: 'accent',
    VERIFIER_IN_PROGRESS: 'warning',
    LOCKED: 'success',
  };
  return (
    <Badge variant={variants[state] ?? 'primary'} size="sm">
      {state.replace(/_/g, ' ')}
    </Badge>
  );
}

const VerifierQueuePage = React.memo(function VerifierQueuePage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search, 250);
  const { data, isPending, isFetching, isError } = useQuery<QueueResponse>({
    queryKey: ['verifier-queue', page, debouncedSearch],
    queryFn: () => evaluationsApi.listVerifierQueue(page, 20, debouncedSearch || undefined),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const total = data?.pagination?.total ?? 0;
  const inProgressCount = useMemo(
    () => items.filter((i) => i.evaluation.workflowState === 'VERIFIER_IN_PROGRESS').length,
    [items],
  );
  const completedReadyCount = useMemo(
    () => items.filter((i) => i.evaluation.workflowState === 'QA_COMPLETED').length,
    [items],
  );

  return (
    <>
      <Topbar title="Verifier Queue" />
      <div className="space-y-6">
        <PageHeader
          eyebrow="Workflow"
          title="Verifier queue"
          titleGradient
          description={
            total > 0
              ? `${total} evaluation${total !== 1 ? 's' : ''} awaiting verifier review.`
              : 'No evaluations awaiting verification.'
          }
          aside={
            total > 0 ? (
              <div className="surface-glass rounded-full px-4 py-2">
                <Badge variant="accent" size="md">
                  {total} pending
                </Badge>
              </div>
            ) : undefined
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Layers className="h-3.5 w-3.5 text-primary-600" />
              Loaded
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-900">{items.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Clock3 className="h-3.5 w-3.5 text-amber-600" />
              In Progress
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-900">{inProgressCount}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <CircleCheckBig className="h-3.5 w-3.5 text-emerald-600" />
              Ready To Verify
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-900">{completedReadyCount}</p>
          </div>
        </div>

        <Card
          shadow="sm"
          className="overflow-hidden border-slate-200/90 bg-white/95 shadow-[0_16px_38px_rgba(15,23,42,0.08)]"
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
              <div className="py-12 text-center text-sm text-slate-600">Loading queue...</div>
            )}
            {isError && <Alert variant="danger">Failed to load verifier queue.</Alert>}
            {!isPending && !isError && items.length === 0 && (
              <div className="flex flex-col items-center py-12 text-center">
                <ShieldCheck className="mb-3 h-10 w-10 text-slate-300" />
                <p className="font-semibold text-slate-700">Queue is empty</p>
                <p className="mt-1 text-sm text-slate-600">
                  Evaluations submitted by QA reviewers will appear here.
                </p>
              </div>
            )}
            {items.length > 0 && (
              <div className="-mx-5 -mb-4 overflow-x-auto">
                {isFetching && (
                  <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-2 text-xs font-medium text-slate-500">
                    Updating queue...
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
                        QA Score
                      </th>
                      <th className="px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                        AI Score
                      </th>
                      <th className="px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                        State
                      </th>
                      <th className="px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                        Submitted
                      </th>
                      <th className="sticky right-0 bg-slate-50 px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500 shadow-[-8px_0_12px_-4px_rgba(0,0,0,0.06)]">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item) => (
                      <tr key={item.id} className="hover:bg-primary-50/30 transition-colors">
                        <td className="px-5 py-3 font-mono text-sm text-slate-700 whitespace-nowrap">
                          {item.evaluation.conversation.externalId ?? item.evaluationId.slice(0, 8)}
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-700 whitespace-nowrap">
                          {item.evaluation.conversation.channel}
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-700 max-w-[140px] truncate">
                          {item.evaluation.conversation.agentName ?? '—'}
                        </td>
                        <td className="px-5 py-3 text-sm">
                          {item.evaluation.qaScore != null ? (
                            <span className="font-semibold text-slate-900">
                              {item.evaluation.qaScore.toFixed(1)}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-sm">
                          {item.evaluation.aiScore != null ? (
                            <span className="text-slate-700">
                              {item.evaluation.aiScore.toFixed(1)}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          <StateBadge state={item.evaluation.workflowState} />
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-600 whitespace-nowrap">
                          {new Date(item.evaluation.conversation.receivedAt).toLocaleDateString()}
                        </td>
                        <td className="sticky right-0 bg-white px-5 py-3 whitespace-nowrap shadow-[-8px_0_12px_-4px_rgba(0,0,0,0.06)]">
                          <Link href={`/verifier-queue/${item.evaluationId}`}>
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
});

export default VerifierQueuePage;
