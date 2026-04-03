'use client';

import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { authApi } from '@/lib/api';
import { setTokens } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { PlanType } from '@qa/shared';
import { ArrowRight } from 'lucide-react';

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
  const [_success, setSuccess] = useState(false);
  const reduceMotion = useReducedMotion();

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
    <div className="relative">
      <h1 className="sr-only">Create workspace</h1>

      {serverError ? (
        <div className="mb-3">
          <Alert variant="danger">{serverError}</Alert>
        </div>
      ) : null}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-3">
        <div>
          <Input
            label="Workspace name"
            placeholder="Acme Corp"
            error={errors.tenantName?.message}
            {...register('tenantName')}
          />
        </div>
        <div>
          <Input
            label="Workspace slug"
            placeholder="acme-corp — used in your URL"
            error={errors.tenantSlug?.message}
            {...register('tenantSlug')}
          />
        </div>
        <div>
          <Input
            label="Your name"
            placeholder="Jane Smith"
            error={errors.adminName?.message}
            {...register('adminName')}
          />
        </div>
        <div>
          <Input
            label="Email"
            type="email"
            placeholder="jane@acme.com"
            error={errors.adminEmail?.message}
            {...register('adminEmail')}
          />
        </div>
        <div>
          <Input
            label="Password"
            type="password"
            placeholder="Min 12 characters"
            error={errors.password?.message}
            {...register('password')}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-800 sm:text-sm">Plan</label>
          <select
            className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-shadow focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            {...register('plan')}
          >
            <option value={PlanType.BASIC}>Basic — free trial</option>
            <option value={PlanType.PRO}>Pro</option>
            <option value={PlanType.ENTERPRISE}>Enterprise</option>
          </select>
          {errors.plan && <p className="mt-1 text-sm text-danger-600">{errors.plan.message}</p>}
        </div>

        <div>
          <motion.div whileHover={reduceMotion ? undefined : { scale: 1.01 }} whileTap={{ scale: 0.99 }}>
            <Button type="submit" className="group w-full" isLoading={isSubmitting}>
              <span>Create workspace</span>
              {!isSubmitting && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />}
            </Button>
          </motion.div>
        </div>
      </form>

      <p className="mt-4 text-center text-xs text-slate-600 sm:text-sm">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-primary-600 hover:text-primary-700 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
