'use client';

import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
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

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/dashboard';
  const [serverError, setServerError] = useState('');
  const reduceMotion = useReducedMotion();

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
    <div className="relative">
      <h1 className="sr-only">Sign in</h1>

      <AnimatePresence mode="wait">
        {serverError ? (
          <motion.div
            key="error"
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 12 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.28 }}
            className="overflow-hidden"
          >
            <Alert variant="danger">{serverError}</Alert>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-3">
        <div>
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="admin@company.com"
            error={errors.email?.message}
            {...register('email')}
          />
        </div>
        <div>
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••••••"
            error={errors.password?.message}
            {...register('password')}
          />
        </div>
        <div>
          <Input
            label="Workspace (optional)"
            type="text"
            placeholder="If you use multiple workspaces"
            error={errors.tenantSlug?.message}
            {...register('tenantSlug')}
          />
        </div>

        <div>
          <motion.div whileHover={reduceMotion ? undefined : { scale: 1.01 }} whileTap={{ scale: 0.99 }}>
            <Button type="submit" className="group w-full" isLoading={isSubmitting}>
              <span>Sign in</span>
              {!isSubmitting && (
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              )}
            </Button>
          </motion.div>
        </div>
      </form>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
        <Link
          href="/forgot-password"
          className="font-medium text-primary-600 transition-colors hover:text-primary-700 hover:underline"
        >
          Forgot password?
        </Link>
        <Link
          href="/signup"
          className="font-medium text-primary-600 transition-colors hover:text-primary-700 hover:underline"
        >
          Create account
        </Link>
      </div>
    </div>
  );
}
