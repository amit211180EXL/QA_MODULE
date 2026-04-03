import * as React from 'react';
import { cn } from '@/lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  bordered?: boolean;
  shadow?: 'xs' | 'sm' | 'base' | 'md' | 'lg';
}

export function Card({ className, bordered = true, shadow = 'sm', ...props }: CardProps) {
  const shadowMap = {
    xs: 'shadow-xs',
    sm: 'shadow-sm',
    base: 'shadow-base',
    md: 'shadow-md',
    lg: 'shadow-lg',
  };

  return (
    <div
      className={cn(
        'rounded-lg bg-white transition-all duration-base',
        bordered && 'border border-slate-200',
        shadowMap[shadow],
        className,
      )}
      {...props}
    />
  );
}

interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  withGradient?: boolean;
}

export function CardHeader({ className, withGradient = false, ...props }: CardHeaderProps) {
  return (
    <div
      className={cn(
        'px-5 py-4 border-b border-slate-100',
        withGradient && 'bg-gradient-to-r from-slate-50 to-white',
        className,
      )}
      {...props}
    />
  );
}

interface CardBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function CardBody({ className, ...props }: CardBodyProps) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

interface CardFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function CardFooter({ className, ...props }: CardFooterProps) {
  return <div className={cn('border-t border-slate-100 px-5 py-4', className)} {...props} />;
}

interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  children: React.ReactNode;
  level?: 'h1' | 'h2' | 'h3' | 'h4';
}

export function CardTitle({ className, level = 'h2', children, ...props }: CardTitleProps) {
  const HeadingTag = level;
  const sizeMap = {
    h1: 'text-2xl font-bold',
    h2: 'text-xl font-bold',
    h3: 'text-lg font-semibold',
    h4: 'text-base font-semibold',
  };

  return (
    <HeadingTag className={cn('text-slate-900', sizeMap[level], className)} {...props}>
      {children}
    </HeadingTag>
  );
}

interface CardDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {
  children: React.ReactNode;
}

export function CardDescription({ className, ...props }: CardDescriptionProps) {
  return <p className={cn('text-sm text-slate-600', className)} {...props} />;
}
