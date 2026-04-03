'use client';

import React, { useState, useMemo } from 'react';
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { usersApi, type CreateUserResult } from '@/lib/api';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Topbar } from '@/components/layout/topbar';
import { UserPlus, MoreVertical, Copy, Check } from 'lucide-react';
import { UserRole } from '@qa/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: string;
}

// ─── Credentials modal (shown after create) ───────────────────────────────────

const CredentialsModal = React.memo(function CredentialsModal({
  result,
  onClose,
}: {
  result: CreateUserResult;
  onClose: () => void;
}) {
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedPass, setCopiedPass] = useState(false);

  const copy = (text: string, type: 'email' | 'pass') => {
    navigator.clipboard.writeText(text);
    if (type === 'email') { setCopiedEmail(true); setTimeout(() => setCopiedEmail(false), 2000); }
    else { setCopiedPass(true); setTimeout(() => setCopiedPass(false), 2000); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="mb-1 text-lg font-semibold text-slate-900">User created</h3>
        <p className="mb-5 text-sm text-slate-500">
          Share these credentials with <strong>{result.user.name}</strong>. The password will not be shown again.
        </p>

        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">Email</p>
              <p className="truncate text-sm font-mono text-slate-900">{result.user.email}</p>
            </div>
            <button
              onClick={() => copy(result.user.email, 'email')}
              className="flex-shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
            >
              {copiedEmail ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">Password</p>
              <p className="truncate text-sm font-mono text-slate-900">{result.password}</p>
            </div>
            <button
              onClick={() => copy(result.password, 'pass')}
              className="flex-shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
            >
              {copiedPass ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
});

const createSchema = z.object({
  email: z.string().email('Enter a valid email'),
  name: z.string().min(2, 'Name is required'),
  role: z.nativeEnum(UserRole),
  password: z.string().min(8, 'Minimum 8 characters').or(z.literal('')).optional(),
});
type CreateFormValues = z.infer<typeof createSchema>;

function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (result: CreateUserResult) => void;
}) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { role: UserRole.QA, password: '' },
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateFormValues) =>
      usersApi.create({
        email: data.email,
        name: data.name,
        role: data.role,
        password: data.password || undefined,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onCreated(result);
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Create team member</h3>
        <form
          onSubmit={handleSubmit((d) => createMutation.mutate(d))}
          noValidate
          className="space-y-4"
        >
          <Input
            label="Email"
            type="email"
            placeholder="user@company.com"
            error={errors.email?.message}
            {...register('email')}
          />
          <Input
            label="Name"
            placeholder="Jane Smith"
            error={errors.name?.message}
            {...register('name')}
          />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Role</label>
            <select
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm transition-all focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              {...register('role')}
            >
              <option value={UserRole.QA}>QA Reviewer</option>
              <option value={UserRole.VERIFIER}>Verifier</option>
              <option value={UserRole.ADMIN}>Admin</option>
            </select>
          </div>
          <Input
            label="Password (optional)"
            type="text"
            placeholder="Leave blank to auto-generate"
            hint="Min 8 characters. Leave blank to auto-generate a strong password."
            error={errors.password?.message}
            {...register('password')}
          />
          {createMutation.isError && (
            <Alert variant="danger">
              {(createMutation.error as { response?: { data?: { error?: { message?: string } } } })
                ?.response?.data?.error?.message ?? 'Failed to create user — please try again.'}
            </Alert>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSubmitting || createMutation.isPending}>
              Create user
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Role badge ───────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.ADMIN]: 'Admin',
  [UserRole.QA]: 'QA Reviewer',
  [UserRole.VERIFIER]: 'Verifier',
};

function RoleBadge({ role }: { role: UserRole }) {
  const variantByRole: Record<UserRole, 'primary' | 'success' | 'warning'> = {
    [UserRole.ADMIN]: 'primary',
    [UserRole.QA]: 'success',
    [UserRole.VERIFIER]: 'warning',
  };
  return (
    <Badge variant={variantByRole[role]} size="sm">
      {ROLE_LABELS[role]}
    </Badge>
  );
}

// ─── Row action menu ──────────────────────────────────────────────────────────

function ActionMenu({
  user,
  onDeactivate,
}: {
  user: User & { isActive: boolean };
  onDeactivate: (id: string) => void;
}) {
  return (
    <DropdownMenu trigger={<MoreVertical className="h-4 w-4 text-slate-500" />}>
      {user.isActive ? (
        <DropdownMenuItem variant="danger" onClick={() => onDeactivate(user.id)}>
          Deactivate
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem onClick={() => {}}>
          <span className="text-slate-400">Inactive</span>
        </DropdownMenuItem>
      )}
    </DropdownMenu>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [createdResult, setCreatedResult] = useState<CreateUserResult | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const debouncedSearch = useDebouncedValue(search, 250);

  const {
    data,
    isPending,
    isFetching,
    isError,
  } = useQuery({
    queryKey: ['users', page, debouncedSearch],
    queryFn: () => usersApi.list({ page, limit: 20, search: debouncedSearch || undefined }),
    placeholderData: keepPreviousData,
  });

  const users: User[] = (data?.items ?? []) as User[];
  const pagination = data?.pagination;

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => usersApi.deactivate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <>
      <Topbar title="Team" />
      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={(result) => {
            setShowCreate(false);
            setCreatedResult(result);
          }}
        />
      )}
      {createdResult && (
        <CredentialsModal result={createdResult} onClose={() => setCreatedResult(null)} />
      )}

      <div className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Team</h1>
            <p className="mt-2 text-base text-slate-600">Manage users and permissions</p>
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Add member
          </Button>
        </div>

      <Card shadow="sm">
        <CardBody className="space-y-4">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by name or email"
            className="w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 transition-all placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        {isPending && users.length === 0 && (
          <div className="flex items-center justify-center py-12 text-sm text-slate-600">
            Loading users...
          </div>
        )}
        {isError && <Alert variant="danger">Failed to load users.</Alert>}
        {!isPending && !isError && users.length === 0 && (
          <div className="flex flex-col items-center py-12 text-center">
            <UserPlus className="mb-3 h-10 w-10 text-slate-300" />
            <p className="text-sm text-slate-600">No team members yet</p>
            <Button className="mt-4" onClick={() => setShowCreate(true)}>
              Add your first member
            </Button>
          </div>
        )}
        {users.length > 0 && (
          <div className="-mx-5 -mb-4 overflow-x-auto">
            {isFetching && (
              <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-2 text-xs font-medium text-slate-500">
                Updating team…
              </div>
            )}
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                    Name
                  </th>
                  <th className="px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                    Email
                  </th>
                  <th className="px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                    Role
                  </th>
                  <th className="px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                    Status
                  </th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-sm font-semibold">
                          {user.name[0]?.toUpperCase()}
                        </div>
                        <span className="text-sm font-semibold text-slate-900">{user.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-700 whitespace-nowrap">
                      {user.email}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <RoleBadge role={user.role} />
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <Badge variant={user.status === 'ACTIVE' ? 'success' : 'default'} size="sm">
                        {user.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <ActionMenu
                        user={{ ...user, isActive: user.status === 'ACTIVE' }}
                        onDeactivate={(id) => deactivateMutation.mutate(id)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 pt-4">
            <p className="text-sm text-slate-600">
              {(page - 1) * pagination.limit + 1}–{Math.min(page * pagination.limit, pagination.total)} of {pagination.total}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
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
        </CardBody>
      </Card>
      </div>
    </>
  );
}






