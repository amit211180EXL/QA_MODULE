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
    <div className="mx-auto max-w-lg">
      <button
        onClick={() => router.push('/forms')}
        className="mb-6 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="h-4 w-4" /> All forms
      </button>

      <h1 className="mb-6 text-xl font-bold text-gray-900">New QA form</h1>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <form
          onSubmit={handleSubmit((d) => createMutation.mutate(d))}
          noValidate
          className="space-y-4"
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
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Channels</label>
            <div className="flex flex-wrap gap-2">
              {['CHAT', 'EMAIL', 'CALL', 'SOCIAL'].map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => toggleChannel(ch)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    channels.includes(ch)
                      ? 'border-primary-600 bg-primary-600 text-white'
                      : 'border-gray-300 bg-white text-gray-600 hover:border-primary-300'
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>

          {createMutation.isError && (
            <Alert variant="error">Failed to create form — please try again.</Alert>
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
