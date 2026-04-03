'use client';

import React, { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Topbar } from '@/components/layout/topbar';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { evaluationsApi, type EscalationQueueItem } from '@/lib/evaluations-api';

interface QueueResponse {
  items: EscalationQueueItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function PriorityBadge({ priority }: { priority: number }) {
  if (priority <= 1) {
    return (
      <Badge variant="danger" size="sm">
        Critical
      </Badge>
    );
  }
  if (priority <= 3) {
    return (
      <Badge variant="warning" size="sm">
        High
      </Badge>
    );
  }
  return (
    <Badge variant="default" size="sm">
      Medium
    </Badge>
  );
}

const PriorityBadgeMemo = React.memo(PriorityBadge);

function StateBadge({ state }: { state: string }) {
  const variants: Record<string, 'primary' | 'accent' | 'warning' | 'danger' | 'success'> = {
    QA_COMPLETED: 'primary',
    VERIFIER_PENDING: 'accent',
    VERIFIER_IN_PROGRESS: 'warning',
    ESCALATION_QUEUE: 'danger',
    LOCKED: 'success',
  };
  return (
    <Badge variant={variants[state] ?? 'danger'} size="sm">
      {state.replace(/_/g, ' ')}
    </Badge>
  );
}

const StateBadgeMemo = React.memo(StateBadge);

function ScorePill({ score }: { score: number | null }) {
  if (score === null) return <span className="text-slate-300">—</span>;
  if (score >= 80)
    return (
      <Badge variant="success" size="sm">
        {score.toFixed(1)}
      </Badge>
    );
  if (score >= 60)
    return (
      <Badge variant="warning" size="sm">
        {score.toFixed(1)}
      </Badge>
    );
  return (
    <Badge variant="danger" size="sm">
      {score.toFixed(1)}
    </Badge>
  );
}

const ScorePillMemo = React.memo(ScorePill);

export default function EscalationQueuePage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search, 250);
  const { data, isPending, isFetching, isError } = useQuery<QueueResponse>({
    queryKey: ['escalation-queue', page, debouncedSearch],
    queryFn: () =>
      evaluationsApi.listEscalationQueue(
        page,
        20,
        debouncedSearch || undefined,
      ) as Promise<QueueResponse>,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const total = data?.pagination?.total ?? 0;

  return (
    <>
      <Topbar title="Escalation Queue" />

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-warning-100 p-2">
              <AlertTriangle className="h-5 w-5 text-warning-700" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Escalation Queue</h1>
              <p className="mt-2 text-base text-slate-600">
                {total > 0
                  ? `${total} high-priority evaluation${total !== 1 ? 's' : ''} requiring immediate verifier attention`
                  : 'No escalated evaluations - all clear'}
              </p>
            </div>
          </div>
          {total > 0 && (
            <Badge variant="danger" size="md">
              {total} pending
            </Badge>
          )}
        </div>

        <Card shadow="xs" className="border-warning-200 bg-warning-50">
          <CardBody>
            <p className="text-sm text-warning-900">
              <strong>What triggers escalation?</strong> Evaluations are automatically escalated
              when the QA deviation from the AI score exceeds the threshold in{' '}
              <strong>Settings - Escalation Rules</strong>.
            </p>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardBody className="space-y-4">
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by external ID, channel, agent, or customer..."
              className="w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 transition-all placeholder:text-slate-500 focus:border-warning-500 focus:outline-none focus:ring-2 focus:ring-warning-500/20"
            />
            {isPending && items.length === 0 && (
              <div className="py-12 text-center text-sm text-slate-600">Loading queue...</div>
            )}
            {isError && <Alert variant="danger">Failed to load escalation queue.</Alert>}
            {!isPending && !isError && items.length === 0 && (
              <div className="flex flex-col items-center py-12 text-center">
                <div className="mb-4 rounded-2xl bg-slate-100 p-4">
                  <AlertTriangle className="h-8 w-8 text-slate-300" />
                </div>
                <p className="text-sm font-semibold text-slate-700">Escalation queue is empty</p>
                <p className="mt-1 text-sm text-slate-600">
                  Evaluations with high QA deviation will appear here automatically.
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
                      <th className="whitespace-nowrap px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                        Priority
                      </th>
                      <th className="whitespace-nowrap px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                        Conversation
                      </th>
                      <th className="whitespace-nowrap px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                        Channel
                      </th>
                      <th className="whitespace-nowrap px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                        Agent
                      </th>
                      <th className="whitespace-nowrap px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                        AI
                      </th>
                      <th className="whitespace-nowrap px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                        QA
                      </th>
                      <th className="whitespace-nowrap px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                        Reason
                      </th>
                      <th className="whitespace-nowrap px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                        State
                      </th>
                      <th className="whitespace-nowrap px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                        Queued
                      </th>
                      <th className="sticky right-0 bg-slate-50 px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500 shadow-[-8px_0_12px_-4px_rgba(0,0,0,0.06)]">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item) => (
                      <tr key={item.id} className="transition-colors hover:bg-warning-50/40">
                        <td className="px-5 py-3">
                          <PriorityBadgeMemo priority={item.priority} />
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-slate-700">
                          {item.evaluation.conversation.externalId ??
                            item.evaluation.id.slice(0, 8)}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-sm capitalize text-slate-700">
                          {item.evaluation.conversation.channel}
                        </td>
                        <td className="max-w-[120px] truncate px-5 py-3 text-sm text-slate-700">
                          {item.evaluation.conversation.agentName ?? '—'}
                        </td>
                        <td className="px-5 py-3">
                          <ScorePillMemo score={item.evaluation.aiScore} />
                        </td>
                        <td className="px-5 py-3">
                          <ScorePillMemo score={item.evaluation.qaScore} />
                        </td>
                        <td
                          className="max-w-[180px] truncate px-5 py-3 text-xs text-danger-700"
                          title={item.evaluation.escalationReason ?? undefined}
                        >
                          {item.evaluation.escalationReason ?? '—'}
                        </td>
                        <td className="px-5 py-3">
                          <StateBadgeMemo state={item.evaluation.workflowState} />
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-600">
                          {new Date(item.createdAt).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="sticky right-0 bg-white px-5 py-3 shadow-[-8px_0_12px_-4px_rgba(0,0,0,0.06)]">
                          <Link href={`/qa-queue/${item.evaluation.id}`}>
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
