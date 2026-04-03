'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { llmApi, usersApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { CheckCircle } from 'lucide-react';
import { UserRole } from '@qa/shared';

const STEPS = ['LLM Config', 'Add Team', 'Done'] as const;
type Step = 0 | 1 | 2;

// ─── Step 1: LLM config ───────────────────────────────────────────────────────

const llmSchema = z.discriminatedUnion('enabled', [
  z.object({
    enabled: z.literal(false),
  }),
  z.object({
    enabled: z.literal(true),
    provider: z.enum(['OPENAI', 'AZURE_OPENAI', 'CUSTOM']),
    model: z.string().min(1, 'Model is required'),
    apiKey: z.string().min(1, 'API key is required'),
    endpoint: z.string().url().optional().or(z.literal('')),
  }),
]);

type LlmFormValues = z.infer<typeof llmSchema>;

function LlmStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);

  const {
    register,
    watch,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LlmFormValues>({
    resolver: zodResolver(llmSchema),
    defaultValues: { enabled: true, provider: 'OPENAI', model: 'gpt-4o' },
  });

  const enabled = watch('enabled' as never) as unknown as boolean;

  const saveMutation = useMutation({
    mutationFn: (data: LlmFormValues) => llmApi.set(data as Record<string, unknown>),
    onSuccess: onNext,
  });

  const testMutation = useMutation({
    mutationFn: () => llmApi.test(),
    onSuccess: () => setTestResult('ok'),
    onError: () => setTestResult('fail'),
  });

  return (
    <form onSubmit={handleSubmit((d) => saveMutation.mutate(d))} noValidate className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-gray-800">Enable AI evaluation</p>
          <p className="text-sm text-gray-500">Connect your LLM to auto-fill QA forms</p>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            className="peer sr-only"
            {...register('enabled' as never)}
            defaultChecked
          />
          <div className="h-6 w-11 rounded-full bg-gray-200 peer-checked:bg-primary-600 transition-colors" />
        </label>
      </div>

      {enabled && (
        <>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Provider</label>
            <select
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              {...register('provider' as never)}
            >
              <option value="OPENAI">OpenAI</option>
              <option value="AZURE_OPENAI">Azure OpenAI</option>
              <option value="CUSTOM">Custom endpoint</option>
            </select>
          </div>
          <Input
            label="Model"
            placeholder="gpt-4o"
            error={(errors as Record<string, { message?: string }>)?.model?.message}
            {...register('model' as never)}
          />
          <Input
            label="API Key"
            type="password"
            placeholder="sk-..."
            error={(errors as Record<string, { message?: string }>)?.apiKey?.message}
            {...register('apiKey' as never)}
          />

          <Button
            type="button"
            variant="secondary"
            size="sm"
            isLoading={testMutation.isPending}
            onClick={() => testMutation.mutate()}
          >
            Test connection
          </Button>
          {testResult === 'ok' && <Alert variant="success">Connection successful</Alert>}
          {testResult === 'fail' && (
            <Alert variant="danger">Connection failed — check your credentials</Alert>
          )}
        </>
      )}

      {saveMutation.isError && <Alert variant="danger">Failed to save. Please try again.</Alert>}

      <div className="flex items-center justify-between pt-2">
        <button type="button" onClick={onSkip} className="text-sm text-gray-500 hover:underline">
          Skip for now
        </button>
        <Button type="submit" isLoading={isSubmitting || saveMutation.isPending}>
          Save &amp; continue
        </Button>
      </div>
    </form>
  );
}

// ─── Step 2: Invite team ──────────────────────────────────────────────────────

const inviteSchema = z.object({
  email: z.string().email('Enter a valid email'),
  name: z.string().min(2, 'Name is required'),
  role: z.nativeEnum(UserRole),
});
type InviteFormValues = z.infer<typeof inviteSchema>;

function InviteStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [invited, setInvited] = useState<string[]>([]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { role: UserRole.QA },
  });

  const inviteMutation = useMutation({
    mutationFn: (data: InviteFormValues) => usersApi.create(data),
    onSuccess: (_data, vars) => {
      setInvited((prev) => [...prev, vars.email]);
      reset();
    },
  });

  return (
    <div className="space-y-4">
      {invited.length > 0 && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-3">
          <p className="text-sm font-medium text-green-800">Created:</p>
          <ul className="mt-1 list-inside list-disc text-sm text-green-700">
            {invited.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <form
        onSubmit={handleSubmit((d) => inviteMutation.mutate(d))}
        noValidate
        className="space-y-4"
      >
        <Input
          label="Email"
          type="email"
          placeholder="colleague@company.com"
          error={errors.email?.message}
          {...register('email')}
        />
        <Input
          label="Name"
          placeholder="Jane Smith"
          error={errors.name?.message}
          {...register('name')}
        />
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Role</label>
          <select
            className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            {...register('role')}
          >
            <option value={UserRole.QA}>QA Reviewer</option>
            <option value={UserRole.VERIFIER}>Verifier</option>
            <option value={UserRole.ADMIN}>Admin</option>
          </select>
        </div>
        {inviteMutation.isError && <Alert variant="danger">Failed to create user.</Alert>}
        <Button
          type="submit"
          variant="secondary"
          isLoading={isSubmitting || inviteMutation.isPending}
        >
          Create user
        </Button>
      </form>

      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <button type="button" onClick={onSkip} className="text-sm text-gray-500 hover:underline">
          Skip for now
        </button>
        <Button onClick={onNext}>Continue</Button>
      </div>
    </div>
  );
}

// ─── Step 3: Done ─────────────────────────────────────────────────────────────

function DoneStep({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <CheckCircle className="mb-4 h-14 w-14 text-green-500" />
      <h3 className="text-lg font-semibold text-gray-900">You&apos;re all set!</h3>
      <p className="mt-2 text-sm text-gray-500">
        Your workspace is ready. Upload your first conversation to start evaluating.
      </p>
      <Button className="mt-6" onClick={onFinish}>
        Go to dashboard
      </Button>
    </div>
  );
}

// ─── Main onboarding page ─────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);

  const next = () => setStep((s) => Math.min(s + 1, 2) as Step);
  const finish = () => router.push('/dashboard');

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-50 to-blue-100 px-4">
      <div className="w-full max-w-lg">
        {/* Step indicator */}
        <div className="mb-8 flex items-center justify-center gap-3">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                  i < step
                    ? 'bg-green-500 text-white'
                    : i === step
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-200 text-gray-500'
                }`}
              >
                {i < step ? '✓' : i + 1}
              </div>
              <span
                className={`text-sm ${i === step ? 'font-medium text-gray-900' : 'text-gray-500'}`}
              >
                {label}
              </span>
              {i < STEPS.length - 1 && <div className="h-px w-8 bg-gray-300" />}
            </div>
          ))}
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-lg">
          <h2 className="mb-1 text-xl font-bold text-gray-900">{STEPS[step]}</h2>
          <p className="mb-6 text-sm text-gray-500">
            {step === 0 && 'Connect your LLM to enable AI-powered evaluations.'}
            {step === 1 && 'Create your QA team members and share their credentials.'}
            {step === 2 && 'Your platform is ready.'}
          </p>

          {step === 0 && <LlmStep onNext={next} onSkip={next} />}
          {step === 1 && <InviteStep onNext={next} onSkip={next} />}
          {step === 2 && <DoneStep onFinish={finish} />}
        </div>
      </div>
    </div>
  );
}
