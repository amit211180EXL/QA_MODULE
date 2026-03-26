'use client';

import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { authApi } from '@/lib/api';
import { setTokens } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import Link from 'next/link';

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

export default function AcceptInvitePage() {
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
      const result = await authApi.acceptInvite(token, values.password);
      setTokens(result.accessToken, result.refreshToken);
      router.push('/dashboard');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Invite link is invalid or expired.';
      setServerError(msg);
    }
  };

  if (!token) {
    return (
      <Alert variant="error">
        Invalid invite link.{' '}
        <Link href="/login" className="underline">
          Go to sign in
        </Link>
      </Alert>
    );
  }

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Accept your invitation</h1>
      <p className="mb-6 text-sm text-gray-500">Set a password to activate your account.</p>

      {serverError && <Alert className="mb-4">{serverError}</Alert>}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <Input
          label="Password"
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
          Activate account
        </Button>
      </form>
    </>
  );
}
