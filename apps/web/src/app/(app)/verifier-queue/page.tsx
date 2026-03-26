'use client';

import { useQuery } from '@tanstack/react-query';
import { Topbar } from '@/components/layout/topbar';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { evaluationsApi, type EvaluationDetail } from '@/lib/evaluations-api';

interface QueueResponse {
  items: EvaluationDetail[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function StateBadge({ state }: { state: string }) {
  const styles: Record<string, string> = {
    QA_COMPLETED: 'bg-blue-50 text-blue-700',
    VERIFIER_PENDING: 'bg-purple-50 text-purple-700',
    VERIFIER_IN_PROGRESS: 'bg-yellow-50 text-yellow-700',
    LOCKED: 'bg-green-100 text-green-800',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        styles[state] ?? 'bg-gray-100 text-gray-500'
      }`}
    >
      {state.replace(/_/g, ' ')}
    </span>
  );
}

export default function VerifierQueuePage() {
  const { data, isLoading, isError } = useQuery<QueueResponse>({
    queryKey: ['verifier-queue'],
    queryFn: () =>
      evaluationsApi.listVerifierQueue(1, 50) as Promise<QueueResponse>,
    refetchInterval: 30_000,
  });

  const items = data?.items ?? [];
  const total = data?.pagination?.total ?? 0;

  return (
    <>
      <Topbar title="Verifier Queue" />
      <div className="p-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Verifier Queue</h2>
          <p className="mt-1 text-sm text-gray-500">
            {total > 0
              ? `${total} evaluation${total !== 1 ? 's' : ''} awaiting verifier review`
              : 'No evaluations awaiting verification'}
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          {isLoading && (
            <div className="py-16 text-center text-sm text-gray-500">Loading queue…</div>
          )}
          {isError && (
            <div className="p-6">
              <Alert variant="error">Failed to load verifier queue.</Alert>
            </div>
          )}
          {!isLoading && !isError && items.length === 0 && (
            <div className="flex flex-col items-center py-16 text-center">
              <ShieldCheck className="mb-3 h-10 w-10 text-gray-300" />
              <p className="font-medium text-gray-700">Queue is empty</p>
              <p className="mt-1 text-sm text-gray-500">
                Evaluations submitted by QA reviewers will appear here.
              </p>
            </div>
          )}
          {!isLoading && items.length > 0 && (
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  {[
                    'Conversation',
                    'Channel',
                    'Agent',
                    'QA Score',
                    'AI Score',
                    'State',
                    'Submitted',
                    'Action',
                  ].map((col) => (
                    <th
                      key={col}
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-sm text-gray-600">
                      {(item as { conversation?: { externalId?: string | null } }).conversation
                        ?.externalId ?? item.conversationId.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {(item as { conversation?: { channel?: string } }).conversation?.channel ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {(item as { conversation?: { agentName?: string | null } }).conversation
                        ?.agentName ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {item.qaScore != null ? (
                        <span className="font-medium text-gray-800">{item.qaScore.toFixed(1)}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {item.aiScore != null ? (
                        <span className="text-gray-600">{item.aiScore.toFixed(1)}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StateBadge state={item.workflowState} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {item.qaCompletedAt
                        ? new Date(item.qaCompletedAt).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/qa-queue/${item.id}`}>
                        <Button size="sm" variant="secondary">
                          Review
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
