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
import { Card, CardBody } from '@/components/ui/card';
import { Zap } from 'lucide-react';
import { Topbar } from '@/components/layout/topbar';
import { PageHeader, SettingsBackLink } from '@/components/layout/page-header';

// ─── Schema ───────────────────────────────────────────────────────────────────

const llmSchema = z.object({
  provider: z.enum(['OPENAI', 'AZURE_OPENAI', 'CUSTOM']),
  model: z.string().min(1, 'Model is required'),
  apiKey: z.string().min(1, 'API key is required'),
  endpoint: z.string().url('Enter a valid URL').optional().or(z.literal('')),
  temperature: z.number({ invalid_type_error: 'Must be a number' }).min(0).max(2).default(0.2),
  maxTokens: z.number({ invalid_type_error: 'Must be a number' }).int().positive().default(2048),
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
    <>
      <Topbar title="LLM" />
      <div className="space-y-6">
        <SettingsBackLink />

        <PageHeader
          eyebrow="Configuration"
          title="LLM"
          titleGradient
          description="Connect a model for automated scoring — reviewers stay in control of the final outcome."
          aside={
            <div className="surface-glass flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-500 to-accent-600 text-white shadow-sm">
                <Zap className="h-4 w-4" aria-hidden />
              </span>
              Model &amp; keys
            </div>
          }
        />

        <Card shadow="sm" className="border-slate-200/90 bg-white/90 shadow-md backdrop-blur-sm">
          <CardBody>
            {isLoading ? (
              <p className="text-sm text-slate-600 py-8">Loading configuration…</p>
            ) : (
              <form
                onSubmit={handleSubmit((d) => saveMutation.mutate(d))}
                noValidate
                className="space-y-6"
              >
                {/* Provider */}
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-900">
                    Provider
                  </label>
                  <select
                    className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm transition-all focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
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
                {saveMutation.isSuccess && (
                  <Alert variant="success">Configuration saved successfully.</Alert>
                )}
                {saveMutation.isError && (
                  <Alert variant="danger">Failed to save — please try again.</Alert>
                )}
                {testMutation.isSuccess && <Alert variant="success">Connection test passed!</Alert>}
                {testMutation.isError && (
                  <Alert variant="danger">Connection test failed — check your credentials.</Alert>
                )}

                {/* Actions */}
                <div className="flex items-center gap-3 pt-4 border-t border-slate-100">
                  <Button
                    type="submit"
                    isLoading={isSubmitting || saveMutation.isPending}
                    disabled={!isDirty && !saveMutation.isIdle}
                  >
                    Save configuration
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    isLoading={testMutation.isPending}
                    onClick={() => testMutation.mutate()}
                  >
                    <Zap className="mr-2 h-4 w-4" />
                    Test connection
                  </Button>
                </div>
              </form>
            )}
          </CardBody>
        </Card>

        {/* Info box */}
        <Card
          shadow="xs"
          className="overflow-hidden border-primary-200/60 bg-gradient-to-r from-primary-50/90 to-white"
        >
          <CardBody className="border-l-4 border-primary-500">
            <p className="text-sm font-medium text-primary-900">
              <strong>Tip:</strong> When AI evaluation is active, uploaded conversations are
              automatically scored against your QA form. You can always override or adjust the
              scores before finalising.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
