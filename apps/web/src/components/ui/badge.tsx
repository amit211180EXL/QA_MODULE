import * as React from 'react';
import { cn } from '@/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md';
}

export function Badge({ className, variant = 'default', size = 'md', ...props }: BadgeProps) {
  const variants = {
    default: 'bg-slate-100 text-slate-800',
    primary: 'bg-primary-100 text-primary-800',
    accent: 'bg-accent-100 text-accent-800',
    success: 'bg-success-50 text-success-700',
    warning: 'bg-warning-50 text-warning-700',
    danger: 'bg-danger-50 text-danger-700',
    info: 'bg-info-50 text-info-700',
  };

  const sizes = {
    sm: 'px-2 py-0.5 text-2xs font-medium',
    md: 'px-2.5 py-1 text-xs font-medium',
  };

  return (
    <div
      className={cn(
        'inline-flex items-center justify-center rounded-full font-medium whitespace-nowrap',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
