'use client';

import React, { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Topbar } from '@/components/layout/topbar';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { ShieldCheck } from 'lucide-react';
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
    <Badge variant={variants[state] ?? 'secondary'} size="sm">
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

  return (
    <>
      <Topbar title="Verifier Queue" />
      <div className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Verifier Queue</h1>
            <p className="mt-2 text-base text-slate-600">
              {total > 0
                ? `${total} evaluation${total !== 1 ? 's' : ''} awaiting verifier review`
                : 'No evaluations awaiting verification'}
            </p>
          </div>
          {total > 0 && (
            <Badge variant="accent" size="md">
              {total} pending
            </Badge>
          )}
        </div>

        <Card shadow="sm">
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
                      <tr key={item.id} className="hover:bg-slate-50">
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
