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

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Conversations', href: '/conversations', icon: MessageSquare },
  {
    label: 'Upload',
    href: '/upload',
    icon: Upload,
    roles: [UserRole.ADMIN],
  },
  { label: 'QA Queue', href: '/qa-queue', icon: CheckSquare, roles: [UserRole.QA, UserRole.ADMIN] },
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
  { label: 'Forms', href: '/forms', icon: FileText, roles: [UserRole.ADMIN] },
  {
    label: 'Analytics',
    href: '/analytics',
    icon: BarChart2,
    roles: [UserRole.ADMIN],
  },
  { label: 'Users', href: '/users', icon: Users, roles: [UserRole.ADMIN] },
  { label: 'Billing', href: '/billing', icon: CreditCard, roles: [UserRole.ADMIN] },
  { label: 'Settings', href: '/settings', icon: Settings, roles: [UserRole.ADMIN] },
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
  const visibleItems = useMemo(
    () => {
      if (!isMounted) {
        return NAV_ITEMS;
      }
      return NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role));
    },
    [isMounted, role],
  );

  const prefetchNavTarget = useCallback((href: string) => {
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
  }, [queryClient]);

  useEffect(() => {
    for (const item of visibleItems) {
      if (!item.disabled) {
        prefetchNavTarget(item.href);
      }
    }
  }, [visibleItems, pathname]);

  return (
    <aside className="relative flex h-full w-64 flex-col border-r border-slate-200/80 bg-slate-50/85 shadow-[4px_0_24px_-12px_rgba(15,23,42,0.08)] backdrop-blur-xl backdrop-saturate-150">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-primary-300/40 to-transparent"
      />
      {/* Logo */}
      <div className="relative flex h-16 shrink-0 items-center gap-3 border-b border-slate-200/70 px-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 via-primary-600 to-accent-600 shadow-md shadow-primary-500/25 ring-2 ring-white/80">
          <CheckSquare className="h-5 w-5 text-white drop-shadow-sm" />
        </div>
        <div className="min-w-0">
          <h1 className="text-base font-bold tracking-tight text-slate-900">QA Platform</h1>
          <p className="text-2xs font-medium text-slate-500">Evaluation Suite</p>
        </div>
      </div>

      {/* Nav — no scroll; items are compact enough to always fit */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4">
        <p className="mb-3 px-2 text-2xs font-semibold uppercase tracking-widest text-slate-500">
          Navigation
        </p>
        <ul className="space-y-1">
          {visibleItems.map((item) => {
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
                    'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-all duration-base ease-smooth',
                    isActive
                      ? 'bg-gradient-to-r from-primary-50 to-white text-primary-800 shadow-sm ring-1 ring-primary-200/60'
                      : 'text-slate-700 hover:bg-white/80 hover:shadow-xs',
                    item.disabled && 'pointer-events-none opacity-40',
                  )}
                >
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-gradient-to-b from-primary-500 to-accent-500 shadow-sm"
                    />
                  )}
                  <item.icon
                    className={cn(
                      'h-5 w-5 shrink-0 transition-transform duration-base ease-smooth group-hover:scale-105',
                      isActive ? 'text-primary-600' : 'text-slate-500 group-hover:text-slate-700',
                    )}
                  />
                  <span className="truncate flex-1">{item.label}</span>
                  {item.disabled && (
                    <span className="ml-auto text-2xs font-semibold text-slate-500">Soon</span>
                  )}
                  {isActive && (
                    <span className="ml-1 h-2 w-2 shrink-0 rounded-full bg-primary-500 shadow-[0_0_8px_rgba(14,165,233,0.6)] motion-safe:animate-pulse" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User footer */}
      <div className="shrink-0 border-t border-slate-200/70 bg-slate-100/40 px-3 py-4 backdrop-blur-sm">
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-slate-200/60 bg-white/60 px-2 py-2 shadow-xs">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-accent-600 text-xs font-bold text-white shadow-md ring-2 ring-white/90">
            {isMounted ? (user?.name?.[0]?.toUpperCase() ?? '?') : '?'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-slate-900">{isMounted ? user?.name : '\u00A0'}</p>
            <p className="truncate text-2xs text-slate-500">{isMounted ? user?.email : '\u00A0'}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 font-medium transition-all duration-base hover:bg-danger-50 hover:text-danger-700"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
