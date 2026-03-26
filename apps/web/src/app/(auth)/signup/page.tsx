'use client';

import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authApi } from '@/lib/api';
import { setTokens } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { PlanType } from '@qa/shared';

const schema = z.object({
  tenantName: z.string().min(2, 'Workspace name is required'),
  tenantSlug: z
    .string()
    .min(3, 'Slug must be at least 3 chars')
    .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens'),
  adminEmail: z.string().email('Enter a valid email'),
  adminName: z.string().min(2, 'Your name is required'),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  plan: z.nativeEnum(PlanType),
});

type FormValues = z.infer<typeof schema>;

export default function SignupPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState('');
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { plan: PlanType.BASIC },
  });

  const onSubmit = async (values: FormValues) => {
    setServerError('');
    try {
      const result = await authApi.signup(values);
      setTokens(result.accessToken, result.refreshToken);
      setSuccess(true);
      router.push('/onboarding');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Signup failed. Please try again.';
      setServerError(msg);
    }
  };

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Create your workspace</h1>
      <p className="mb-6 text-sm text-gray-500">Get started with a free trial — no credit card required</p>

      {serverError && (
        <Alert variant="error" className="mb-4">
          {serverError}
        </Alert>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <Input
          label="Workspace name"
          placeholder="Acme Corp"
          error={errors.tenantName?.message}
          {...register('tenantName')}
        />
        <Input
          label="Workspace slug"
          placeholder="acme-corp"
          hint="Used in your URL — cannot be changed"
          error={errors.tenantSlug?.message}
          {...register('tenantSlug')}
        />
        <Input
          label="Your name"
          placeholder="Jane Smith"
          error={errors.adminName?.message}
          {...register('adminName')}
        />
        <Input
          label="Email"
          type="email"
          placeholder="jane@acme.com"
          error={errors.adminEmail?.message}
          {...register('adminEmail')}
        />
        <Input
          label="Password"
          type="password"
          placeholder="Min 12 characters"
          error={errors.password?.message}
          {...register('password')}
        />

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Plan</label>
          <select
            className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            {...register('plan')}
          >
            <option value={PlanType.BASIC}>Basic — free trial</option>
            <option value={PlanType.PRO}>Pro</option>
            <option value={PlanType.ENTERPRISE}>Enterprise</option>
          </select>
          {errors.plan && <p className="mt-1.5 text-sm text-red-600">{errors.plan.message}</p>}
        </div>

        <Button type="submit" className="w-full" isLoading={isSubmitting}>
          Create workspace
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        Already have an account?{' '}
        <Link href="/login" className="text-primary-600 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
