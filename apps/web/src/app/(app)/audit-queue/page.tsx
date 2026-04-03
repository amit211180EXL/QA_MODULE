'use client';

import React, { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { Topbar } from '@/components/layout/topbar';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { evaluationsApi, type AuditQueueItem } from '@/lib/evaluations-api';

interface QueueResponse {
  items: AuditQueueItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function PriorityBadge({ priority }: { priority: number }) {
  if (priority <= 1) {
    return <Badge variant="danger" size="sm">Critical</Badge>;
  }
  if (priority <= 3) {
    return <Badge variant="warning" size="sm">High</Badge>;
  }
  return <Badge variant="default" size="sm">Medium</Badge>;
}

const PriorityBadgeMemo = React.memo(PriorityBadge);

function DeviationPill({ deviation, threshold }: { deviation: number; threshold: number }) {
  const isBreach = deviation >= threshold;
  return <Badge variant={isBreach ? 'danger' : 'success'} size="sm">{deviation.toFixed(1)} / {threshold.toFixed(1)}</Badge>;
}

const DeviationPillMemo = React.memo(DeviationPill);

export default function AuditQueuePage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [noteByCaseId, setNoteByCaseId] = useState<Record<string, string>>({});
  const debouncedSearch = useDebouncedValue(search, 250);

  const { data, isPending, isFetching, isError } = useQuery<QueueResponse>({
    queryKey: ['audit-queue', page, debouncedSearch],
    queryFn: () => evaluationsApi.listAuditQueue(page, 20, debouncedSearch || undefined) as Promise<QueueResponse>,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, dismiss, note }: { id: string; dismiss: boolean; note?: string }) =>
      evaluationsApi.resolveAuditCase(id, { dismiss, note }),
    onSuccess: () => {
      setActiveCaseId(null);
      qc.invalidateQueries({ queryKey: ['audit-queue'] });
    },
  });

  const items = data?.items ?? [];
  const total = data?.pagination?.total ?? 0;

  return (
    <>
      <Topbar title="Audit Queue" />
      <div className="space-y-6">
        <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-danger-500" />
                <h1 className="text-3xl font-bold text-slate-900">Audit Queue</h1>
              </div>
              <p className="mt-2 text-base text-slate-600">
                {total > 0
                  ? `${total} verifier-deviation audit case${total !== 1 ? 's' : ''} pending review`
                  : 'No open audit cases'}
              </p>
            </div>
            {total > 0 && <Badge variant="danger" size="md">{total} open</Badge>}
        </div>

        <Card shadow="sm">
          <CardBody className="space-y-4">
            <div className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-800">
              Cases are created automatically when verifier deviation exceeds the configured threshold.
            </div>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by external ID, channel, agent, or customer"
              className="w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 transition-all placeholder:text-slate-500 focus:border-danger-500 focus:outline-none focus:ring-2 focus:ring-danger-500/20"
            />
          {isPending && items.length === 0 && <div className="py-12 text-center text-sm text-slate-600">Loading queue...</div>}
          {isError && <Alert variant="danger">Failed to load audit queue.</Alert>}
          {!isPending && !isError && items.length === 0 && (
            <div className="flex flex-col items-center py-12 text-center">
              <ShieldAlert className="mb-3 h-10 w-10 text-slate-300" />
              <p className="font-semibold text-slate-700">Audit queue is empty</p>
              <p className="mt-1 text-sm text-slate-600">
                High verifier-deviation cases will appear here.
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
                      Priority
                    </th>
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
                      Deviation / Threshold
                    </th>
                    <th className="px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                      Reason
                    </th>
                    <th className="px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                      Created
                    </th>
                    <th className="sticky right-0 bg-slate-50 px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500 shadow-[-8px_0_12px_-4px_rgba(0,0,0,0.06)]">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item) => {
                    const auditCase = item.evaluation.auditCase;
                    if (!auditCase) return null;
                    const isBusy = resolveMutation.isPending && activeCaseId === auditCase.id;

                    return (
                      <tr key={item.id} className="hover:bg-danger-50/30">
                        <td className="px-5 py-3">
                          <PriorityBadgeMemo priority={item.priority} />
                        </td>
                        <td className="px-5 py-3 font-mono text-sm text-slate-700 whitespace-nowrap">
                          {item.evaluation.conversation.externalId ?? item.evaluation.id.slice(0, 8)}
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-700 capitalize whitespace-nowrap">
                          {item.evaluation.conversation.channel}
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-700 max-w-[140px] truncate">
                          {item.evaluation.conversation.agentName ?? '—'}
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          <DeviationPillMemo deviation={auditCase.deviation} threshold={auditCase.threshold} />
                        </td>
                        <td className="px-5 py-3 text-sm text-danger-700 max-w-[220px] truncate" title={auditCase.reason}>
                          {auditCase.reason}
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-600 whitespace-nowrap">
                          {new Date(item.createdAt).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="sticky right-0 bg-white px-5 py-3 shadow-[-8px_0_12px_-4px_rgba(0,0,0,0.06)]">
                          <div className="flex flex-col gap-2">
                            <Link href={`/qa-queue/${item.evaluation.id}`}>
                              <button className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-black">
                                Open Evaluation
                              </button>
                            </Link>

                            <input
                              className="w-52 rounded-md border border-slate-200 px-2 py-1 text-xs"
                              placeholder="Resolution note (optional)"
                              value={noteByCaseId[auditCase.id] ?? ''}
                              onChange={(e) =>
                                setNoteByCaseId((prev) => ({ ...prev, [auditCase.id]: e.target.value }))
                              }
                            />

                            <div className="flex gap-2">
                              <Button
                                disabled={isBusy}
                                size="sm"
                                variant="success"
                                onClick={() => {
                                  setActiveCaseId(auditCase.id);
                                  resolveMutation.mutate({
                                    id: auditCase.id,
                                    dismiss: false,
                                    note: noteByCaseId[auditCase.id],
                                  });
                                }}
                              >
                                Resolve
                              </Button>
                              <Button
                                disabled={isBusy}
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setActiveCaseId(auditCase.id);
                                  resolveMutation.mutate({
                                    id: auditCase.id,
                                    dismiss: true,
                                    note: noteByCaseId[auditCase.id],
                                  });
                                }}
                              >
                                Dismiss
                              </Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {data?.pagination && data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
              <p className="text-sm text-slate-600">
                {(page - 1) * data.pagination.limit + 1}–{Math.min(page * data.pagination.limit, data.pagination.total)} of {data.pagination.total}
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




