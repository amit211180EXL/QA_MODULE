'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { formsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Topbar } from '@/components/layout/topbar';
import { PageHeader } from '@/components/layout/page-header';
import { ArrowLeft } from 'lucide-react';

const schema = z.object({
  formKey: z
    .string()
    .min(2, 'Key must be at least 2 characters')
    .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers and hyphens'),
  name: z.string().min(2, 'Name is required'),
  description: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export default function NewFormPage() {
  const router = useRouter();
  const [channels, setChannels] = useState<string[]>(['CHAT']);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const createMutation = useMutation({
    mutationFn: (data: FormValues) =>
      formsApi.create({
        ...data,
        channels,
        scoringStrategy: { type: 'WEIGHTED', passMark: 70 },
        sections: [],
        questions: [],
      }),
    onSuccess: (form) => {
      router.push(`/forms/${form.id}`);
    },
  });

  const toggleChannel = (ch: string) =>
    setChannels((prev) => (prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]));

  return (
    <div className="max-w-3xl pb-2">
      <Topbar title="New QA Form" />
      <button
        type="button"
        onClick={() => router.push('/forms')}
        className="surface-glass mb-4 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-slate-600 transition hover:text-primary-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> All forms
      </button>

      <PageHeader
        eyebrow="Templates"
        title="New QA form"
        titleGradient
        description="Create the shell first, then add sections and questions in the builder."
        className="mb-4"
      />

      <div className="mb-4 overflow-hidden rounded-2xl border border-slate-200/90 bg-white/90 shadow-md backdrop-blur-sm">
        <form
          onSubmit={handleSubmit((d) => createMutation.mutate(d))}
          noValidate
          className="space-y-4 px-5 py-5"
        >
          <Input
            label="Form key"
            placeholder="customer-support-v1"
            hint="Unique identifier — lowercase with hyphens, no spaces"
            error={errors.formKey?.message}
            {...register('formKey')}
          />
          <Input
            label="Name"
            placeholder="Customer Support Evaluation"
            error={errors.name?.message}
            {...register('name')}
          />
          <Input
            label="Description"
            placeholder="Optional description"
            {...register('description')}
          />

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Channels</label>
            <div className="flex flex-wrap gap-2">
              {['CHAT', 'EMAIL', 'CALL', 'SOCIAL'].map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => toggleChannel(ch)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    channels.includes(ch)
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-300 bg-white text-slate-600 hover:border-blue-300'
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>

          {createMutation.isError && (
            <Alert variant="danger">Failed to create form — please try again.</Alert>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => router.push('/forms')}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSubmitting || createMutation.isPending}>
              Create &amp; open builder
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
