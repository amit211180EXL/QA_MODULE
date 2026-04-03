'use client';

import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { authApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { CheckCircle2, ArrowLeft } from 'lucide-react';
import { authEase } from '@/components/auth/auth-motion';

const schema = z.object({ email: z.string().email('Enter a valid email') });
type FormValues = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
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
      await authApi.forgotPassword(values.email);
      setSent(true);
    } catch {
      setServerError('Something went wrong. Please try again.');
    }
  };

  if (sent) {
    return (
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.35, ease: authEase }}
        className="text-center"
      >
        <div
          className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-success-500 to-success-600 text-white shadow-lg shadow-success-500/25"
          aria-hidden
        >
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
          Check your inbox
        </h1>
        <p className="mx-auto mt-1.5 max-w-sm text-xs leading-snug text-slate-600 sm:text-sm">
          If an account exists for that email, we&apos;ve sent a reset link.
        </p>
        <div className="mt-5">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 text-xs font-semibold text-primary-600 hover:text-primary-700 hover:underline sm:text-sm"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Link>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="relative">
      <h1 className="sr-only">Reset your password</h1>

      {serverError ? (
        <div className="mb-3">
          <Alert variant="danger">{serverError}</Alert>
        </div>
      ) : null}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-3">
        <div>
          <Input
            label="Email"
            type="email"
            placeholder="you@company.com"
            error={errors.email?.message}
            {...register('email')}
          />
        </div>
        <div>
          <motion.div
            whileHover={reduceMotion ? undefined : { scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
          >
            <Button type="submit" className="w-full" isLoading={isSubmitting}>
              Send reset link
            </Button>
          </motion.div>
        </div>
      </form>

      <p className="mt-4 text-center text-xs sm:text-sm">
        <Link
          href="/login"
          className="inline-flex items-center justify-center gap-1.5 font-semibold text-primary-600 hover:text-primary-700 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
