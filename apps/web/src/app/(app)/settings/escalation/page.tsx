'use client';

import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { settingsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Card, CardBody } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';
import { Topbar } from '@/components/layout/topbar';
import { PageHeader, SettingsBackLink } from '@/components/layout/page-header';

const schema = z.object({
  qaDeviationThreshold: z
    .number({ invalid_type_error: 'Must be a number' })
    .min(0)
    .max(100),
  verifierDeviationThreshold: z
    .number({ invalid_type_error: 'Must be a number' })
    .min(0)
    .max(100),
  staleQueueHours: z
    .number({ invalid_type_error: 'Must be a number' })
    .int()
    .min(1),
});

type EscalationValues = z.infer<typeof schema>;

export default function EscalationPage() {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get(),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<EscalationValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      qaDeviationThreshold: 15,
      verifierDeviationThreshold: 10,
      staleQueueHours: 24,
    },
  });

  useEffect(() => {
    if (settings) {
      reset({
        qaDeviationThreshold: settings.escalation?.qaDeviationThreshold ?? 15,
        verifierDeviationThreshold: settings.escalation?.verifierDeviationThreshold ?? 10,
        staleQueueHours: settings.escalation?.staleQueueHours ?? 24,
      });
    }
  }, [settings, reset]);

  const saveMutation = useMutation({
    mutationFn: (data: EscalationValues) => settingsApi.updateEscalation(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  return (
    <>
      <Topbar title="Escalation" />
      <div className="space-y-6">
        <SettingsBackLink />

        <PageHeader
          eyebrow="Automation"
          title="Escalation rules"
          titleGradient
          description="Route high-deviation evaluations to the escalation queue before they tie up your verifier bench."
          aside={
            <div className="surface-glass flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-warning-800">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-warning-500 to-warning-600 text-white shadow-sm">
                <AlertTriangle className="h-4 w-4" aria-hidden />
              </span>
              Thresholds
            </div>
          }
        />

      {isLoading ? (
        <div className="py-8 text-center text-sm text-slate-500">Loading…</div>
      ) : (
        <form onSubmit={handleSubmit((data) => saveMutation.mutate(data))}>
          <Card shadow="sm" className="border-slate-200/90 bg-white/90 backdrop-blur-sm">
            <CardBody className="space-y-6">
              {/* QA deviation threshold */}
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">
                  QA deviation threshold (%)
                </label>
                <p className="text-sm text-slate-600 mb-3">
                  When the difference between AI score and QA score exceeds this value, the
                  evaluation is automatically escalated to the verifier queue with high priority.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    {...register('qaDeviationThreshold', { valueAsNumber: true })}
                    className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                  <span className="text-sm text-slate-600">%</span>
                </div>
                {errors.qaDeviationThreshold && (
                  <p className="mt-2 text-sm text-danger-600">{errors.qaDeviationThreshold.message}</p>
                )}
              </div>

              <div className="border-t border-slate-100" />

              {/* Verifier deviation threshold */}
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">
                  Verifier deviation threshold (%)
                </label>
                <p className="text-sm text-slate-600 mb-3">
                  When the difference between QA score and verifier score exceeds this value, an
                  audit case is flagged.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    {...register('verifierDeviationThreshold', { valueAsNumber: true })}
                    className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                  <span className="text-sm text-slate-600">%</span>
                </div>
                {errors.verifierDeviationThreshold && (
                  <p className="mt-2 text-sm text-danger-600">
                    {errors.verifierDeviationThreshold.message}
                  </p>
                )}
              </div>

              <div className="border-t border-slate-100" />

              {/* Stale queue hours */}
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">
                  Stale queue timeout (hours)
                </label>
                <p className="text-sm text-slate-600 mb-3">
                  Evaluations that remain unclaimed in the queue longer than this are elevated in
                  priority.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    {...register('staleQueueHours', { valueAsNumber: true })}
                    className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                  <span className="text-sm text-slate-600">hours</span>
                </div>
                {errors.staleQueueHours && (
                  <p className="mt-2 text-sm text-danger-600">{errors.staleQueueHours.message}</p>
                )}
              </div>
            </CardBody>
          </Card>

          {saveMutation.isError && (
            <Alert variant="danger" className="mt-6">
              Failed to save settings. Please try again.
            </Alert>
          )}
          {saveMutation.isSuccess && !isDirty && (
            <Alert variant="success" className="mt-6">
              Escalation rules saved successfully.
            </Alert>
          )}

          <div className="mt-6 flex justify-end">
            <Button type="submit" isLoading={saveMutation.isPending} disabled={!isDirty}>
              Save rules
            </Button>
          </div>
        </form>
      )}
      </div>
    </>
  );
}


