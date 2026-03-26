'use client';

import { useQuery } from '@tanstack/react-query';
import { evaluationsApi, type EvaluationDetail } from '@/lib/evaluations-api';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ClipboardList } from 'lucide-react';
import Link from 'next/link';

type QueueItem = EvaluationDetail;

interface QueueResponse {
  items: QueueItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

// ─── State badge ──────────────────────────────────────────────────────────────

function StateBadge({ state }: { state: string }) {
  const styles: Record<string, string> = {
    AI_PENDING: 'bg-blue-50 text-blue-700',
    AI_COMPLETE: 'bg-indigo-50 text-indigo-700',
    QA_REVIEW: 'bg-yellow-50 text-yellow-700',
    QA_COMPLETE: 'bg-green-50 text-green-700',
    VERIFIER_REVIEW: 'bg-purple-50 text-purple-700',
    VERIFIER_COMPLETE: 'bg-green-100 text-green-800',
    ESCALATED: 'bg-red-50 text-red-700',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[state] ?? 'bg-gray-100 text-gray-500'}`}>
      {state.replace(/_/g, ' ')}
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function QaQueuePage() {
  const { data, isLoading, isError } = useQuery<QueueResponse>({
    queryKey: ['qa-queue'],
    queryFn: () => evaluationsApi.listQaQueue(1, 50),
    refetchInterval: 30_000,
  });

  const items: QueueItem[] = data?.items ?? [];
  const total = data?.pagination?.total ?? 0;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">QA Queue</h1>
          <p className="text-sm text-gray-500">
            {total > 0 ? `${total} item${total !== 1 ? 's' : ''} awaiting review` : 'No items in queue'}
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white overflow-hidden">
        {isLoading && <div className="py-16 text-center text-sm text-gray-500">Loading queue…</div>}
        {isError && (
          <div className="p-6"><Alert variant="error">Failed to load QA queue.</Alert></div>
        )}
        {!isLoading && !isError && items.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <ClipboardList className="mb-3 h-10 w-10 text-gray-300" />
            <p className="text-gray-700 font-medium">Queue is empty</p>
            <p className="mt-1 text-sm text-gray-500">New conversations will appear here after AI evaluation</p>
            <Link href="/conversations">
              <Button className="mt-4" variant="secondary">Go to Conversations</Button>
            </Link>
          </div>
        )}
        {!isLoading && items.length > 0 && (
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50">
              <tr>
                {['Conversation', 'Channel', 'Agent', 'AI Score', 'State', 'Received', 'Action'].map((col) => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-mono text-gray-600">
                    {item.conversation.externalId ?? item.conversationId.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{item.conversation.channel}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{item.conversation.agentName ?? '—'}</td>
                  <td className="px-4 py-3">
                    {item.aiScore !== null ? (
                      <span className="text-sm font-medium text-gray-800">{item.aiScore.toFixed(1)}%</span>
                    ) : (
                      <span className="text-sm text-gray-400">Pending</span>
                    )}
                  </td>
                  <td className="px-4 py-3"><StateBadge state={item.workflowState} /></td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(item.conversation.receivedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/qa-queue/${item.id}`}>
                      <Button size="sm" variant="secondary">Review</Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
