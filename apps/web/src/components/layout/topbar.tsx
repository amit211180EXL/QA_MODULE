'use client';

import { useAuth } from '@/context/auth-context';

interface TopbarProps {
  title: string;
}

export function Topbar({ title }: TopbarProps) {
  const { user } = useAuth();
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/75 shadow-xs backdrop-blur-xl backdrop-saturate-150">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary-400/35 to-transparent"
      />
      <div className="relative flex h-16 items-center justify-between px-1 sm:px-2">
        <h1 className="text-lg font-bold tracking-tight text-slate-900">{title}</h1>
        <div className="flex items-center gap-3 sm:gap-4">
          <span className="hidden max-w-[12rem] truncate text-sm font-medium text-slate-600 sm:block">
            {user?.name}
          </span>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 via-primary-600 to-accent-600 text-sm font-bold text-white shadow-md shadow-primary-500/20 ring-2 ring-white">
            {user?.name?.[0]?.toUpperCase() ?? '?'}
          </div>
        </div>
      </div>
    </header>
  );
}
