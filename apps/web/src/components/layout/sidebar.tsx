'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useCallback, useMemo, useState } from 'react';
import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard,
  MessageSquare,
  FileText,
  CheckSquare,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  BarChart2,
  Users,
  Settings,
  LogOut,
  CreditCard,
  Upload,
  ClipboardList,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/auth-context';
import { analyticsApi } from '@/lib/analytics-api';
import { billingApi, conversationsApi, formsApi, settingsApi, usersApi } from '@/lib/api';
import { evaluationsApi } from '@/lib/evaluations-api';
import { UserRole } from '@qa/shared';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  roles?: UserRole[];
  disabled?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Workspace',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { label: 'Conversations', href: '/conversations', icon: MessageSquare },
      {
        label: 'Upload',
        href: '/upload',
        icon: Upload,
        roles: [UserRole.ADMIN],
      },
    ],
  },
  {
    title: 'Operations',
    items: [
      {
        label: 'QA Queue',
        href: '/qa-queue',
        icon: CheckSquare,
        roles: [UserRole.QA, UserRole.ADMIN],
      },
      {
        label: 'Verifier Queue',
        href: '/verifier-queue',
        icon: ShieldCheck,
        roles: [UserRole.VERIFIER, UserRole.ADMIN],
      },
      {
        label: 'Escalation Queue',
        href: '/escalation-queue',
        icon: AlertTriangle,
        roles: [UserRole.VERIFIER, UserRole.ADMIN],
      },
      {
        label: 'Audit Queue',
        href: '/audit-queue',
        icon: ShieldAlert,
        roles: [UserRole.VERIFIER, UserRole.ADMIN],
      },
    ],
  },
  {
    title: 'Insights',
    items: [
      { label: 'Analytics', href: '/analytics', icon: BarChart2, roles: [UserRole.ADMIN] },
      { label: 'Reports', href: '/reports', icon: ClipboardList, roles: [UserRole.ADMIN] },
      {
        label: 'Question Scores',
        href: '/question-scores',
        icon: ClipboardList,
        roles: [UserRole.ADMIN],
      },
    ],
  },
  {
    title: 'Configuration',
    items: [
      { label: 'Forms', href: '/forms', icon: FileText, roles: [UserRole.ADMIN] },
      { label: 'Users', href: '/users', icon: Users, roles: [UserRole.ADMIN] },
      { label: 'Billing', href: '/billing', icon: CreditCard, roles: [UserRole.ADMIN] },
      { label: 'Settings', href: '/settings', icon: Settings, roles: [UserRole.ADMIN] },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const role = user?.role as UserRole;
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Keep server and first client render identical; apply role filtering after mount.
  const visibleGroups = useMemo(() => {
    if (!isMounted) {
      return NAV_GROUPS;
    }
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.roles || item.roles.includes(role)),
    })).filter((group) => group.items.length > 0);
  }, [isMounted, role]);

  const visibleItems = useMemo(
    () => visibleGroups.flatMap((group) => group.items),
    [visibleGroups],
  );

  const prefetchNavTarget = useCallback(
    (href: string) => {
      void router.prefetch(href);

      switch (href) {
        case '/dashboard':
          void queryClient.prefetchQuery({
            queryKey: ['analytics', 'overview'],
            queryFn: () => analyticsApi.overview(),
            staleTime: 60_000,
          });
          void queryClient.prefetchQuery({
            queryKey: ['analytics', 'escalation-stats'],
            queryFn: () => analyticsApi.escalationStats(),
            staleTime: 60_000,
          });
          break;
        case '/conversations':
          void queryClient.prefetchQuery({
            queryKey: ['conversations', '', '', 1],
            queryFn: () => conversationsApi.list({ page: 1, limit: 20 }),
            staleTime: 60_000,
          });
          break;
        case '/qa-queue':
          void queryClient.prefetchQuery({
            queryKey: ['qa-queue', 1, ''],
            queryFn: () => evaluationsApi.listQaQueue(1, 20),
            staleTime: 60_000,
          });
          break;
        case '/verifier-queue':
          void queryClient.prefetchQuery({
            queryKey: ['verifier-queue', 1, ''],
            queryFn: () => evaluationsApi.listVerifierQueue(1, 20),
            staleTime: 60_000,
          });
          break;
        case '/escalation-queue':
          void queryClient.prefetchQuery({
            queryKey: ['escalation-queue', 1, ''],
            queryFn: () => evaluationsApi.listEscalationQueue(1, 20),
            staleTime: 60_000,
          });
          break;
        case '/audit-queue':
          void queryClient.prefetchQuery({
            queryKey: ['audit-queue', 1, ''],
            queryFn: () => evaluationsApi.listAuditQueue(1, 20),
            staleTime: 60_000,
          });
          break;
        case '/forms':
          void queryClient.prefetchQuery({
            queryKey: ['forms', 1, ''],
            queryFn: () => formsApi.list({ page: 1, limit: 20 }),
            staleTime: 60_000,
          });
          break;
        case '/users':
          void queryClient.prefetchQuery({
            queryKey: ['users', 1, ''],
            queryFn: () => usersApi.list({ page: 1, limit: 20 }),
            staleTime: 60_000,
          });
          break;
        case '/billing':
          void queryClient.prefetchQuery({
            queryKey: ['billing'],
            queryFn: () => billingApi.getSubscription(),
            staleTime: 60_000,
          });
          void queryClient.prefetchQuery({
            queryKey: ['billing-usage'],
            queryFn: () => billingApi.getUsage(),
            staleTime: 60_000,
          });
          break;
        case '/settings':
          void queryClient.prefetchQuery({
            queryKey: ['settings'],
            queryFn: () => settingsApi.get(),
            staleTime: 60_000,
          });
          break;
        default:
          break;
      }
    },
    [queryClient],
  );

  useEffect(() => {
    for (const item of visibleItems) {
      if (!item.disabled) {
        prefetchNavTarget(item.href);
      }
    }
  }, [visibleItems, pathname]);

  return (
    <aside className="flex h-full w-64 flex-col border-r border-slate-200 bg-slate-50/70">
      <div className="shrink-0 border-b border-slate-200 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-600">
            <CheckSquare className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-black tracking-tight text-slate-900">QA Platform</h1>
            <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Evaluation Suite
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
        <div className="space-y-3">
          {visibleGroups.map((group) => (
            <section key={group.title}>
              <p className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                {group.title}
              </p>
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.disabled ? '#' : item.href}
                        prefetch={!item.disabled}
                        onMouseEnter={() => {
                          if (!item.disabled) prefetchNavTarget(item.href);
                        }}
                        aria-disabled={item.disabled}
                        className={cn(
                          'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-semibold transition-all duration-base ease-smooth',
                          isActive
                            ? 'bg-white text-slate-900 ring-1 ring-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.06)]'
                            : 'text-slate-700 hover:bg-white/80 hover:text-slate-900',
                          item.disabled && 'pointer-events-none opacity-40',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                            isActive ? 'bg-slate-100 text-slate-700' : 'text-slate-500',
                          )}
                        >
                          <item.icon className="h-4 w-4" />
                        </span>
                        <span className="truncate flex-1">{item.label}</span>
                        {item.disabled && (
                          <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                            Soon
                          </span>
                        )}
                        {isActive && <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </nav>

      <div className="shrink-0 border-t border-slate-200 bg-slate-100/70 px-3 py-3">
        <div className="mb-2 flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-xs font-black text-white">
            {isMounted ? (user?.name?.[0]?.toUpperCase() ?? '?') : '?'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-slate-900">{isMounted ? user?.name : '\u00A0'}</p>
            <p className="truncate text-2xs text-slate-500">{isMounted ? user?.email : '\u00A0'}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-all duration-base hover:border-danger-200 hover:bg-danger-50 hover:text-danger-700"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
