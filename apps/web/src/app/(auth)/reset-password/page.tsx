'use client';

import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { authApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { ShieldAlert } from 'lucide-react';

const schema = z
  .object({
    password: z.string().min(12, 'Password must be at least 12 characters'),
    confirm: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.password === d.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  });

type FormValues = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
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
      await authApi.resetPassword(token, values.password);
      router.push('/login?reset=1');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Reset failed. The link may have expired.';
      setServerError(msg);
    }
  };

  if (!token) {
    return (
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.45 }}
        className="text-center"
      >
        <div
          className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-danger-500 to-danger-600 text-white shadow-lg shadow-danger-500/20"
          aria-hidden
        >
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-bold text-slate-900 sm:text-xl">Link invalid or expired</h1>
        <p className="mt-1.5 text-xs text-slate-600 sm:text-sm">Request a fresh reset email to continue.</p>
        <div className="mt-4 text-left">
          <Alert variant="danger">
            Invalid reset link. Please request a new one.{' '}
            <Link href="/forgot-password" className="font-semibold underline">
              Forgot password
            </Link>
          </Alert>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="relative">
      <h1 className="sr-only">Set new password</h1>

      {serverError ? (
        <div className="mb-3">
          <Alert variant="danger">{serverError}</Alert>
        </div>
      ) : null}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-3">
        <div>
          <Input
            label="New password"
            type="password"
            placeholder="Min 12 characters"
            error={errors.password?.message}
            {...register('password')}
          />
        </div>
        <div>
          <Input
            label="Confirm password"
            type="password"
            placeholder="Repeat your password"
            error={errors.confirm?.message}
            {...register('confirm')}
          />
        </div>
        <div>
          <motion.div whileHover={reduceMotion ? undefined : { scale: 1.01 }} whileTap={{ scale: 0.99 }}>
            <Button type="submit" className="w-full" isLoading={isSubmitting}>
              Update password
            </Button>
          </motion.div>
        </div>
      </form>

      <p className="mt-4 text-center text-xs sm:text-sm">
        <Link href="/login" className="font-semibold text-primary-600 hover:text-primary-700 hover:underline">
          ← Back to sign in
        </Link>
      </p>
    </div>
  );
}
