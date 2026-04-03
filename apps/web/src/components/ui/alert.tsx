import { cn } from '@/lib/utils';

interface AlertProps {
  variant?: 'danger' | 'success' | 'warning' | 'info';
  children: React.ReactNode;
  className?: string;
}

export function Alert({ variant = 'info', children, className }: AlertProps) {
  const styles = {
    danger: 'bg-danger-50 border border-danger-200 text-danger-800',
    success: 'bg-success-50 border border-success-200 text-success-800',
    warning: 'bg-warning-50 border border-warning-200 text-warning-800',
    info: 'bg-info-50 border border-info-200 text-info-800',
  };
  return (
    <div className={cn('rounded-md px-4 py-3 text-sm font-medium', styles[variant], className)}>
      {children}
    </div>
  );
}
