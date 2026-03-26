'use client';

import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { llmApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Zap } from 'lucide-react';

// ─── Schema ───────────────────────────────────────────────────────────────────

const llmSchema = z.object({
  provider: z.enum(['OPENAI', 'AZURE_OPENAI', 'CUSTOM']),
  model: z.string().min(1, 'Model is required'),
  apiKey: z.string().min(1, 'API key is required'),
  endpoint: z.string().url('Enter a valid URL').optional().or(z.literal('')),
  temperature: z
    .number({ invalid_type_error: 'Must be a number' })
    .min(0)
    .max(2)
    .default(0.2),
  maxTokens: z
    .number({ invalid_type_error: 'Must be a number' })
    .int()
    .positive()
    .default(2048),
});

type LlmFormValues = z.infer<typeof llmSchema>;

interface LlmConfig extends LlmFormValues {
  id?: string;
  maskedKey?: string;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LlmSettingsPage() {
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery<LlmConfig>({
    queryKey: ['llm-config'],
    queryFn: () => llmApi.get(),
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<LlmFormValues>({
    resolver: zodResolver(llmSchema),
    defaultValues: {
      provider: 'OPENAI',
      model: 'gpt-4o',
      temperature: 0.2,
      maxTokens: 2048,
    },
  });

  // Populate form when existing config loads
  useEffect(() => {
    if (config) {
      reset({
        provider: config.provider,
        model: config.model,
        apiKey: config.maskedKey ?? '',
        endpoint: config.endpoint ?? '',
        temperature: config.temperature ?? 0.2,
        maxTokens: config.maxTokens ?? 2048,
      });
    }
  }, [config, reset]);

  const saveMutation = useMutation({
    mutationFn: (data: LlmFormValues) => llmApi.set(data as Record<string, unknown>),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['llm-config'] }),
  });

  const testMutation = useMutation({
    mutationFn: () => llmApi.test(),
  });

  const provider = watch('provider');

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">LLM Configuration</h1>
        <p className="text-sm text-gray-500">Connect an AI model to power automated QA evaluations.</p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        {isLoading ? (
          <p className="text-sm text-gray-500 py-4">Loading configuration…</p>
        ) : (
          <form onSubmit={handleSubmit((d) => saveMutation.mutate(d))} noValidate className="space-y-5">
            {/* Provider */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Provider</label>
              <select
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                {...register('provider')}
              >
                <option value="OPENAI">OpenAI</option>
                <option value="AZURE_OPENAI">Azure OpenAI</option>
                <option value="CUSTOM">Custom endpoint</option>
              </select>
            </div>

            {/* Model */}
            <Input
              label="Model"
              placeholder={provider === 'AZURE_OPENAI' ? 'gpt-4o-deployment' : 'gpt-4o'}
              error={errors.model?.message}
              {...register('model')}
            />

            {/* API key */}
            <Input
              label="API Key"
              type="password"
              placeholder="sk-…  (leave unchanged to keep existing key)"
              hint={config?.maskedKey ? `Current: ${config.maskedKey}` : undefined}
              error={errors.apiKey?.message}
              {...register('apiKey')}
            />

            {/* Endpoint (Azure / Custom only) */}
            {provider !== 'OPENAI' && (
              <Input
                label="Endpoint URL"
                type="url"
                placeholder="https://your-resource.openai.azure.com"
                error={errors.endpoint?.message}
                {...register('endpoint')}
              />
            )}

            {/* Advanced */}
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Temperature"
                type="number"
                step={0.1}
                placeholder="0.2"
                hint="0 – 2 (lower = more deterministic)"
                error={errors.temperature?.message}
                {...register('temperature', { valueAsNumber: true })}
              />
              <Input
                label="Max tokens"
                type="number"
                placeholder="2048"
                error={errors.maxTokens?.message}
                {...register('maxTokens', { valueAsNumber: true })}
              />
            </div>

            {/* Feedback */}
            {saveMutation.isSuccess && <Alert variant="success">Configuration saved.</Alert>}
            {saveMutation.isError && <Alert variant="error">Failed to save — please try again.</Alert>}
            {testMutation.isSuccess && <Alert variant="success">Connection test passed!</Alert>}
            {testMutation.isError && <Alert variant="error">Connection test failed — check your credentials.</Alert>}

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" isLoading={isSubmitting || saveMutation.isPending} disabled={!isDirty && !saveMutation.isIdle}>
                Save configuration
              </Button>
              <Button
                type="button"
                variant="secondary"
                isLoading={testMutation.isPending}
                onClick={() => testMutation.mutate()}
              >
                <Zap className="mr-1.5 h-4 w-4" />
                Test connection
              </Button>
            </div>
          </form>
        )}
      </div>

      {/* Info box */}
      <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-700">
        <strong>Tip:</strong> When AI evaluation is active, uploaded conversations are automatically scored against your
        QA form. You can always override or adjust the scores before finalising.
      </div>
    </div>
  );
}
