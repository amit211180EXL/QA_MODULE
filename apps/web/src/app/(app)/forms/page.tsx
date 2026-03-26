'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { formsApi, FormListItem } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { PlusCircle, MoreVertical, FileText } from 'lucide-react';

// ─── Status badge ─────────────────────────────────────────────────────────────

const FORM_STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  PUBLISHED: 'bg-green-100 text-green-700',
  DEPRECATED: 'bg-orange-100 text-orange-700',
  ARCHIVED: 'bg-red-100 text-red-600',
};

function FormStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${FORM_STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-500'}`}
    >
      {status}
    </span>
  );
}

// ─── Action menu ──────────────────────────────────────────────────────────────

const NEXT_ACTIONS: Record<
  string,
  { label: string; action: 'publish' | 'deprecate' | 'archive' }[]
> = {
  DRAFT: [
    { label: 'Publish', action: 'publish' },
    { label: 'Archive', action: 'archive' },
  ],
  PUBLISHED: [{ label: 'Deprecate', action: 'deprecate' }],
  DEPRECATED: [{ label: 'Archive', action: 'archive' }],
  ARCHIVED: [],
};

function FormActionMenu({
  form,
  onStatusChange,
}: {
  form: FormListItem;
  onStatusChange: (id: string, action: 'publish' | 'deprecate' | 'archive') => void;
}) {
  const [open, setOpen] = useState(false);
  const actions = NEXT_ACTIONS[form.status] ?? [];
  if (!actions.length) return null;

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="rounded p-1 hover:bg-gray-100">
        <MoreVertical className="h-4 w-4 text-gray-500" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-36 rounded-lg border border-gray-200 bg-white py-1 shadow-lg text-sm">
            {actions.map(({ label, action }) => (
              <button
                key={action}
                className="block w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  onStatusChange(form.id, action);
                  setOpen(false);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FormsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    data: forms = [],
    isLoading,
    isError,
  } = useQuery<FormListItem[]>({
    queryKey: ['forms'],
    queryFn: () => formsApi.list(),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'publish' | 'deprecate' | 'archive' }) =>
      formsApi.changeStatus(id, action),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['forms'] }),
  });

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">QA Forms</h1>
          <p className="text-sm text-gray-500">Define evaluation templates for conversations</p>
        </div>
        <Button onClick={() => router.push('/forms/new')}>
          <PlusCircle className="mr-2 h-4 w-4" />
          New form
        </Button>
      </div>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white overflow-hidden">
        {isLoading && <div className="py-16 text-center text-sm text-gray-500">Loading forms…</div>}
        {isError && (
          <div className="p-6">
            <Alert variant="error">Failed to load forms.</Alert>
          </div>
        )}
        {!isLoading && !isError && forms.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <FileText className="mb-3 h-10 w-10 text-gray-300" />
            <p className="text-gray-500 text-sm">No forms yet</p>
            <Button className="mt-4" onClick={() => router.push('/forms/new')}>
              Create your first form
            </Button>
          </div>
        )}
        {!isLoading && forms.length > 0 && (
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50">
              <tr>
                {['Name', 'Key', 'Version', 'Channels', 'Status', 'Published', ''].map((col) => (
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
              {forms.map((form) => (
                <tr key={form.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => router.push(`/forms/${form.id}`)}
                      className="text-left hover:underline"
                    >
                      <p className="text-sm font-medium text-primary-700">{form.name}</p>
                    </button>
                    {form.description && (
                      <p className="text-xs text-gray-500 mt-0.5">{form.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-600">{form.formKey}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">v{form.version}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(form.channels as string[]).map((ch) => (
                        <span
                          key={ch}
                          className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600"
                        >
                          {ch}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <FormStatusBadge status={form.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {form.publishedAt ? new Date(form.publishedAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <FormActionMenu
                      form={form}
                      onStatusChange={(id, action) => statusMutation.mutate({ id, action })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
