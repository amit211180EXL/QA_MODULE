'use client';

import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useAuth } from '@/context/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { ShieldCheck, Sparkles, ArrowRight } from 'lucide-react';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
  tenantSlug: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

function LoginPageContent() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/dashboard';
  const [serverError, setServerError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    setServerError('');
    try {
      await login(values.email, values.password, values.tenantSlug);
      router.push(next);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Login failed. Check your credentials.';
      setServerError(msg);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl">
      <div className="pointer-events-none absolute -left-14 -top-14 h-36 w-36 rounded-full bg-primary-200/60 blur-2xl animate-pulse" />
      <div className="pointer-events-none absolute -bottom-16 -right-12 h-40 w-40 rounded-full bg-accent-200/60 blur-2xl animate-pulse" />

      <div className="relative">
        <div className="mb-6">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-primary-700">
            <Sparkles className="h-3.5 w-3.5" />
            Secure Workspace Access
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Welcome back</h1>
          <p className="mt-2 text-sm text-slate-600">
            Sign in to continue your quality operations with confidence.
          </p>
        </div>

        {serverError && (
          <Alert variant="danger" className="mb-4">
            {serverError}
          </Alert>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="admin@company.com"
            error={errors.email?.message}
            {...register('email')}
          />
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••••••"
            error={errors.password?.message}
            {...register('password')}
          />
          <Input
            label="Workspace slug (optional)"
            type="text"
            placeholder="acme-corp"
            hint="Required if you belong to multiple workspaces"
            error={errors.tenantSlug?.message}
            {...register('tenantSlug')}
          />

          <Button type="submit" className="group w-full" isLoading={isSubmitting}>
            <span>Sign in</span>
            {!isSubmitting && (
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            )}
          </Button>
        </form>

        <div className="mt-6 flex items-center justify-between text-sm">
          <Link
            href="/forgot-password"
            className="text-primary-600 transition-colors hover:text-primary-700 hover:underline"
          >
            Forgot password?
          </Link>
          <Link
            href="/signup"
            className="text-primary-600 transition-colors hover:text-primary-700 hover:underline"
          >
            Create account
          </Link>
        </div>

        <div className="mt-6 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-wide text-slate-600">
            <ShieldCheck className="h-3.5 w-3.5 text-success-600" />
            Encrypted Session · Role-Based Access · Tenant Isolation
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}
