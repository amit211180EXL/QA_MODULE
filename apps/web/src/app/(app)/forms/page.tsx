'use client';

import React, { useState } from 'react';
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { formsApi, FormListItem } from '@/lib/api';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Topbar } from '@/components/layout/topbar';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { PlusCircle, MoreVertical, FileText } from 'lucide-react';

// ─── Status badge ─────────────────────────────────────────────────────────────

const FORM_STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  PUBLISHED: 'bg-emerald-100 text-emerald-700',
  DEPRECATED: 'bg-orange-100 text-orange-700',
  ARCHIVED: 'bg-red-100 text-red-600',
};

const FormStatusBadge = React.memo(function FormStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${FORM_STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-500'}`}
    >
      {status}
    </span>
  );
});

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

const FormActionMenu = React.memo(function FormActionMenu({
  form,
  onStatusChange,
}: {
  form: FormListItem;
  onStatusChange: (id: string, action: 'publish' | 'deprecate' | 'archive') => void;
}) {
  const actions = NEXT_ACTIONS[form.status] ?? [];
  if (!actions.length) return null;

  return (
    <DropdownMenu trigger={<MoreVertical className="h-4 w-4 text-gray-500" />}>
      {actions.map(({ label, action }) => (
        <DropdownMenuItem key={action} onClick={() => onStatusChange(form.id, action)}>
          {label}
        </DropdownMenuItem>
      ))}
    </DropdownMenu>
  );
});

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FormsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search, 250);

  const { data, isPending, isFetching, isError } = useQuery({
    queryKey: ['forms', page, debouncedSearch],
    queryFn: () => formsApi.list({ page, limit: 20, search: debouncedSearch || undefined }),
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
  });

  const forms: FormListItem[] = data?.items ?? [];
  const pagination = data?.pagination;

  const statusMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'publish' | 'deprecate' | 'archive' }) =>
      formsApi.changeStatus(id, action),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['forms'] }),
  });

  return (
    <>
      <Topbar title="QA Forms" />
      {/* Page header */}
      <div className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.05)]">
        <div className="flex items-center justify-between bg-gradient-to-r from-slate-50 to-white px-5 py-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">QA Forms</h1>
            <p className="text-sm text-slate-500">Define evaluation templates for conversations</p>
          </div>
          <Button onClick={() => router.push('/forms/new')}>
            <PlusCircle className="mr-2 h-4 w-4" />
            New form
          </Button>
        </div>
      </div>

      {/* Table card */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.05)]">
        {/* Search bar */}
        <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-4 py-3">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search forms by key, name, or description…"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {isPending && forms.length === 0 && (
          <div className="py-16 text-center text-sm text-slate-400">Loading forms…</div>
        )}
        {isError && (
          <div className="flex items-start gap-2 px-5 py-4">
            <Alert variant="danger">Failed to load forms.</Alert>
          </div>
        )}
        {!isPending && !isError && forms.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="mb-4 rounded-2xl bg-slate-100 p-4">
              <FileText className="h-8 w-8 text-slate-300" />
            </div>
            <p className="text-sm font-medium text-slate-500">No forms yet</p>
            <Button className="mt-4" onClick={() => router.push('/forms/new')}>
              Create your first form
            </Button>
          </div>
        )}
        {forms.length > 0 && (
          <div className="overflow-x-auto">
            {isFetching && (
              <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-2 text-xs font-medium text-slate-500">
                Updating forms…
              </div>
            )}
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50/80">
                <tr>
                  <th className="px-4 py-2.5 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                    Name
                  </th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                    Key
                  </th>
                  <th className="px-4 py-2.5 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                    Ver
                  </th>
                  <th className="px-4 py-2.5 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                    Channels
                  </th>
                  <th className="px-4 py-2.5 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                    Status
                  </th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                    Published
                  </th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {forms.map((form) => (
                  <tr key={form.id} className="transition-colors hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => router.push(`/forms/${form.id}`)}
                        className="text-left"
                      >
                        <p className="text-sm font-semibold text-blue-600 hover:underline">
                          {form.name}
                        </p>
                      </button>
                      {form.description && (
                        <p className="mt-0.5 text-xs text-slate-400">{form.description}</p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-500">
                        {form.formKey}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-500">
                      v{form.version}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(form.channels as string[]).map((ch) => (
                          <span
                            key={ch}
                            className="whitespace-nowrap rounded-md bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-600"
                          >
                            {ch}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <FormStatusBadge status={form.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-400">
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
          </div>
        )}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-4 py-3">
            <p className="text-sm text-slate-500">
              {(page - 1) * pagination.limit + 1}–
              {Math.min(page * pagination.limit, pagination.total)} of {pagination.total}
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
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
