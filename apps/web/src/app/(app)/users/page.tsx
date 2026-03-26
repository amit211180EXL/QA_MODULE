'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { usersApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { UserPlus, MoreVertical } from 'lucide-react';
import { UserRole } from '@qa/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: string;
}

// ─── Invite modal ─────────────────────────────────────────────────────────────

const inviteSchema = z.object({
  email: z.string().email('Enter a valid email'),
  name: z.string().min(2, 'Name is required'),
  role: z.nativeEnum(UserRole),
});
type InviteFormValues = z.infer<typeof inviteSchema>;

function InviteModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { role: UserRole.QA },
  });

  const inviteMutation = useMutation({
    mutationFn: (data: InviteFormValues) => usersApi.invite(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">Invite team member</h3>
        <form
          onSubmit={handleSubmit((d) => inviteMutation.mutate(d))}
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
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Role</label>
            <select
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              {...register('role')}
            >
              <option value={UserRole.QA}>QA Reviewer</option>
              <option value={UserRole.VERIFIER}>Verifier</option>
              <option value={UserRole.ADMIN}>Admin</option>
            </select>
          </div>
          {inviteMutation.isError && (
            <Alert variant="error">Failed to send invite — please try again.</Alert>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSubmitting || inviteMutation.isPending}>
              Send invite
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Role badge ───────────────────────────────────────────────────────────────

const ROLE_STYLES: Record<UserRole, string> = {
  [UserRole.ADMIN]: 'bg-blue-100 text-blue-800',
  [UserRole.QA]: 'bg-green-100 text-green-800',
  [UserRole.VERIFIER]: 'bg-orange-100 text-orange-800',
};

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.ADMIN]: 'Admin',
  [UserRole.QA]: 'QA Reviewer',
  [UserRole.VERIFIER]: 'Verifier',
};

function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_STYLES[role]}`}
    >
      {ROLE_LABELS[role]}
    </span>
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
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="rounded p-1 hover:bg-gray-100">
        <MoreVertical className="h-4 w-4 text-gray-500" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg text-sm">
            {user.isActive ? (
              <button
                className="block w-full px-4 py-2 text-left text-red-600 hover:bg-red-50"
                onClick={() => {
                  onDeactivate(user.id);
                  setOpen(false);
                }}
              >
                Deactivate
              </button>
            ) : (
              <span className="block px-4 py-2 text-gray-400">Inactive</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const [showInvite, setShowInvite] = useState(false);
  const queryClient = useQueryClient();

  const {
    data: users = [],
    isLoading,
    isError,
  } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => usersApi.list() as unknown as Promise<User[]>,
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => usersApi.deactivate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <>
      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team</h1>
          <p className="text-sm text-gray-500">Manage users and permissions</p>
        </div>
        <Button onClick={() => setShowInvite(true)}>
          <UserPlus className="mr-2 h-4 w-4" />
          Invite member
        </Button>
      </div>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white overflow-hidden">
        {isLoading && (
          <div className="flex items-center justify-center py-16 text-sm text-gray-500">
            Loading users…
          </div>
        )}
        {isError && (
          <div className="p-6">
            <Alert variant="error">Failed to load users.</Alert>
          </div>
        )}
        {!isLoading && !isError && users.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <UserPlus className="mb-3 h-10 w-10 text-gray-300" />
            <p className="text-gray-500 text-sm">No team members yet</p>
            <Button className="mt-4" onClick={() => setShowInvite(true)}>
              Invite your first member
            </Button>
          </div>
        )}
        {!isLoading && users.length > 0 && (
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50">
              <tr>
                {['Name', 'Email', 'Role', 'Status', ''].map((col) => (
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
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-sm font-semibold">
                        {user.name[0]?.toUpperCase()}
                      </div>
                      <span className="text-sm font-medium text-gray-900">{user.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{user.email}</td>
                  <td className="px-4 py-3">
                    <RoleBadge role={user.role} />
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        user.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {user.status === 'ACTIVE'
                        ? 'Active'
                        : user.status === 'INVITED'
                          ? 'Invited'
                          : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ActionMenu
                      user={{ ...user, isActive: user.status === 'ACTIVE' }}
                      onDeactivate={(id) => deactivateMutation.mutate(id)}
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
