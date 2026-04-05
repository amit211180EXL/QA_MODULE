'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { formsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Topbar } from '@/components/layout/topbar';
import { ArrowLeft } from 'lucide-react';
import { isAxiosError } from 'axios';

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
  const queryClient = useQueryClient();
  const [channels, setChannels] = useState<string[]>(['CHAT']);
  const [channelError, setChannelError] = useState<string | null>(null);

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
        scoringStrategy: {
          type: 'weighted_sections',
          passMark: 70,
          scale: 100,
          roundingPolicy: 'round',
        },
        sections: [],
        questions: [],
      }),
    onSuccess: async (form) => {
      await queryClient.invalidateQueries({ queryKey: ['forms'] });
      router.push(`/forms/${form.id}`);
    },
  });

  const toggleChannel = (ch: string) =>
    setChannels((prev) => {
      const next = prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch];
      if (next.length > 0) setChannelError(null);
      return next;
    });

  const getCreateErrorMessage = () => {
    if (!createMutation.error) return 'Failed to create form — please try again.';
    if (isAxiosError(createMutation.error)) {
      const apiMessage = createMutation.error.response?.data as
        | { error?: { message?: string } }
        | undefined;
      return apiMessage?.error?.message ?? 'Failed to create form — please try again.';
    }
    return 'Failed to create form — please try again.';
  };

  return (
    <div className="max-w-3xl pb-2">
      <Topbar title="New QA Form" />
      <button
        onClick={() => router.push('/forms')}
        className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> All forms
      </button>

      <div className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.05)]">
        <div className="bg-gradient-to-r from-slate-50 to-white px-5 py-3">
          <h1 className="text-xl font-bold text-slate-900">New QA form</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Create the shell first, then add sections and questions in the builder.
          </p>
        </div>

        <form
          onSubmit={handleSubmit((d) => {
            if (channels.length === 0) {
              setChannelError('Select at least one channel');
              return;
            }
            setChannelError(null);
            createMutation.mutate(d);
          })}
          noValidate
          className="space-y-4 px-5 py-4"
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
            {channelError && <p className="mt-1 text-xs text-red-600">{channelError}</p>}
          </div>

          {createMutation.isError && (
            <Alert variant="danger">{getCreateErrorMessage()}</Alert>
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
