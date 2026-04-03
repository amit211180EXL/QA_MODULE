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
import { ArrowRight } from 'lucide-react';

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
    <div className="animate-[fadeIn_0.4s_ease-out]">
      {/* Header */}
      <div className="mb-5">
        <h1 className="bg-gradient-to-br from-slate-900 via-primary-700 to-accent-600 bg-clip-text text-2xl font-bold tracking-tight text-transparent">
          Welcome back
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Sign in to continue your quality operations.
        </p>
      </div>

      {/* Gradient accent line */}
      <div className="mb-5 h-px w-full bg-gradient-to-r from-primary-400 via-accent-400 to-transparent" />

      {serverError && (
        <Alert variant="danger" className="mb-4">
          {serverError}
        </Alert>
      )}

      {/* Form */}
      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="space-y-4 animate-[fadeIn_0.5s_ease-out_0.1s_both]"
      >
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

        <Button
          type="submit"
          className="group w-full bg-gradient-to-r from-primary-600 to-accent-600 hover:from-primary-500 hover:to-accent-500"
          isLoading={isSubmitting}
        >
          <span>Sign in</span>
          {!isSubmitting && (
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          )}
        </Button>
      </form>

      {/* Links */}
      <div className="mt-5 flex items-center justify-between text-sm animate-[fadeIn_0.5s_ease-out_0.2s_both]">
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
