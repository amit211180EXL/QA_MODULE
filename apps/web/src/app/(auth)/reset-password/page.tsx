'use client';

import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { authApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';

const schema = z
  .object({
    password: z.string().min(12, 'Password must be at least 12 characters'),
    confirm: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.password === d.confirm, { path: ['confirm'], message: 'Passwords do not match' });

type FormValues = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [serverError, setServerError] = useState('');

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
      <Alert variant="error">
        Invalid reset link. Please request a new one.{' '}
        <Link href="/forgot-password" className="underline">
          Reset password
        </Link>
      </Alert>
    );
  }

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Set new password</h1>
      <p className="mb-6 text-sm text-gray-500">Choose a strong password of at least 12 characters.</p>

      {serverError && <Alert className="mb-4">{serverError}</Alert>}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <Input
          label="New password"
          type="password"
          placeholder="Min 12 characters"
          error={errors.password?.message}
          {...register('password')}
        />
        <Input
          label="Confirm password"
          type="password"
          placeholder="Repeat your password"
          error={errors.confirm?.message}
          {...register('confirm')}
        />
        <Button type="submit" className="w-full" isLoading={isSubmitting}>
          Set password
        </Button>
      </form>
    </>
  );
}
