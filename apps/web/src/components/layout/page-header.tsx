import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

export type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  titleGradient?: boolean;
  description?: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
};

export function PageHeader({
  eyebrow,
  title,
  titleGradient,
  description,
  aside,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn('flex flex-col gap-4 md:flex-row md:items-end md:justify-between', className)}
    >
      <div>
        {eyebrow ? (
          <p className="text-2xs font-bold uppercase tracking-[0.2em] text-primary-600/90">
            {eyebrow}
          </p>
        ) : null}
        <h1
          className={cn(
            'text-3xl font-bold tracking-tight md:text-4xl',
            eyebrow ? 'mt-2' : undefined,
          )}
        >
          {titleGradient ? (
            <span className="text-gradient-brand">{title}</span>
          ) : (
            <span className="text-slate-900">{title}</span>
          )}
        </h1>
        {description ? (
          <div className="mt-2 max-w-2xl text-base text-slate-600">{description}</div>
        ) : null}
      </div>
      {aside ? <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div> : null}
    </div>
  );
}

export function SettingsBackLink({ className }: { className?: string }) {
  return (
    <Link
      href="/settings"
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-lg px-1 py-0.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-white/70 hover:text-primary-700',
        className,
      )}
    >
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
      Back to Settings
    </Link>
  );
}
