'use client';

import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { settingsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Card, CardBody } from '@/components/ui/card';
import { EyeOff } from 'lucide-react';
import { Topbar } from '@/components/layout/topbar';
import { PageHeader, SettingsBackLink } from '@/components/layout/page-header';

interface BlindReviewValues {
  hideAgentFromQA: boolean;
  hideQAFromVerifier: boolean;
}

export default function BlindReviewPage() {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get(),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { isDirty },
  } = useForm<BlindReviewValues>({
    defaultValues: { hideAgentFromQA: false, hideQAFromVerifier: false },
  });

  useEffect(() => {
    if (settings) {
      reset({
        hideAgentFromQA: settings.blindReview?.hideAgentFromQA ?? false,
        hideQAFromVerifier: settings.blindReview?.hideQAFromVerifier ?? false,
      });
    }
  }, [settings, reset]);

  const saveMutation = useMutation({
    mutationFn: (data: BlindReviewValues) => settingsApi.updateBlindReview(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  return (
    <>
      <Topbar title="Blind review" />
      <div className="space-y-6">
        <SettingsBackLink />

        <PageHeader
          eyebrow="Fairness"
          title="Blind review"
          titleGradient
          description="Mask agent identity from QA and QA scores from verifiers to keep reviews objective."
          aside={
            <div className="surface-glass flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-slate-600 to-slate-800 text-white shadow-sm">
                <EyeOff className="h-4 w-4" aria-hidden />
              </span>
              Bias controls
            </div>
          }
        />

        {isLoading ? (
          <div className="py-8 text-center text-sm text-slate-500">Loading…</div>
        ) : (
          <form onSubmit={handleSubmit((data) => saveMutation.mutate(data))}>
            <Card shadow="sm" className="border-slate-200/90 bg-white/90 backdrop-blur-sm">
              <CardBody className="space-y-6">
                {/* hideAgentFromQA */}
                <label className="flex items-start gap-4 cursor-pointer">
                  <div className="flex h-6 items-center">
                    <input
                      type="checkbox"
                      {...register('hideAgentFromQA')}
                      className="h-4 w-4 rounded border-slate-300 text-primary-600 transition-colors focus:ring-2 focus:ring-primary-500/20"
                    />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Hide agent identity from QA</p>
                    <p className="mt-2 text-sm text-slate-600">
                      When enabled, QA reviewers see a masked agent identifier (e.g.{' '}
                      <span className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">
                        Agent #a3f7
                      </span>
                      ) instead of the real agent name and ID, reducing recency or familiarity bias.
                    </p>
                  </div>
                </label>

                <div className="border-t border-slate-100" />

                {/* hideQAFromVerifier */}
                <label className="flex items-start gap-4 cursor-pointer">
                  <div className="flex h-6 items-center">
                    <input
                      type="checkbox"
                      {...register('hideQAFromVerifier')}
                      className="h-4 w-4 rounded border-slate-300 text-primary-600 transition-colors focus:ring-2 focus:ring-primary-500/20"
                    />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Hide QA scores from verifier</p>
                    <p className="mt-2 text-sm text-slate-600">
                      When enabled, verifiers do not see the QA score before making their decision,
                      ensuring an independent final review.
                    </p>
                  </div>
                </label>
              </CardBody>
            </Card>

            {saveMutation.isError && (
              <Alert variant="danger" className="mt-6">
                Failed to save settings. Please try again.
              </Alert>
            )}
            {saveMutation.isSuccess && !isDirty && (
              <Alert variant="success" className="mt-6">
                Blind review settings saved successfully.
              </Alert>
            )}

            <div className="mt-6 flex justify-end">
              <Button type="submit" isLoading={saveMutation.isPending} disabled={!isDirty}>
                Save settings
              </Button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
