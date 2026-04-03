'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Mail, Send, ShieldCheck } from 'lucide-react';
import { settingsApi, type SmtpEncryption, type UpdateTenantEmailSettingsPayload } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Topbar } from '@/components/layout/topbar';
import { PageHeader, SettingsBackLink } from '@/components/layout/page-header';

const emailSchema = z
  .object({
    smtpHost: z.string().trim().max(255, 'Host must be 255 characters or fewer'),
    smtpPort: z.coerce.number().int('Port must be a whole number').min(1).max(65535),
    encryption: z.enum(['NONE', 'TLS', 'SSL']),
    smtpUsername: z.string().trim().max(255, 'Username must be 255 characters or fewer'),
    smtpPassword: z.string().max(500, 'Password must be 500 characters or fewer'),
    fromEmail: z.string().trim(),
    fromName: z.string().trim().max(120, 'Sender name must be 120 characters or fewer'),
    notificationsEnabled: z.boolean(),
    forgotPasswordEnabled: z.boolean(),
    testEmailTo: z.string().trim(),
  })
  .superRefine((values, ctx) => {
    if (values.smtpHost && !values.fromEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fromEmail'],
        message: 'Sender email is required when custom SMTP is enabled',
      });
    }

    if (values.fromEmail && !z.string().email().safeParse(values.fromEmail).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fromEmail'],
        message: 'Enter a valid sender email address',
      });
    }

    if (values.testEmailTo && !z.string().email().safeParse(values.testEmailTo).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['testEmailTo'],
        message: 'Enter a valid test email address',
      });
    }
  });

type EmailFormValues = z.infer<typeof emailSchema>;

const ENCRYPTION_OPTIONS: Array<{ value: SmtpEncryption; label: string; description: string }> = [
  { value: 'TLS', label: 'TLS / STARTTLS', description: 'Recommended for port 587 and modern SMTP relays.' },
  { value: 'SSL', label: 'SSL', description: 'Use implicit SSL, typically on port 465.' },
  { value: 'NONE', label: 'None', description: 'Plain SMTP with no TLS negotiation.' },
];

function getErrorMessage(error: unknown, fallback: string) {
  return (
    (error as { response?: { data?: { error?: { message?: string }; message?: string } } })?.response
      ?.data?.error?.message ||
    (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
    (error as Error)?.message ||
    fallback
  );
}

function buildPayload(values: EmailFormValues, includePassword: boolean): UpdateTenantEmailSettingsPayload {
  const payload: UpdateTenantEmailSettingsPayload = {
    smtpHost: values.smtpHost.trim(),
    smtpPort: values.smtpPort,
    encryption: values.encryption,
    smtpUsername: values.smtpUsername.trim(),
    fromEmail: values.fromEmail.trim(),
    fromName: values.fromName.trim(),
    notificationsEnabled: values.notificationsEnabled,
    forgotPasswordEnabled: values.forgotPasswordEnabled,
  };

  if (includePassword) {
    payload.smtpPassword = values.smtpPassword;
  }

  return payload;
}

export default function EmailConfigurationPage() {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<{ type: 'success' | 'danger'; message: string } | null>(null);

  const { data: emailSettings, isLoading, isError: isLoadError } = useQuery({
    queryKey: ['settings', 'email'],
    queryFn: () => settingsApi.getEmail(),
    retry: 1,
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    clearErrors,
    formState: { errors, isDirty },
  } = useForm<EmailFormValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: {
      smtpHost: '',
      smtpPort: 587,
      encryption: 'TLS',
      smtpUsername: '',
      smtpPassword: '',
      fromEmail: '',
      fromName: '',
      notificationsEnabled: true,
      forgotPasswordEnabled: true,
      testEmailTo: '',
    },
  });

  useEffect(() => {
    if (emailSettings) {
      reset({
        smtpHost: emailSettings.smtpHost,
        smtpPort: emailSettings.smtpPort,
        encryption: emailSettings.encryption,
        smtpUsername: emailSettings.smtpUsername,
        smtpPassword: '',
        fromEmail: emailSettings.fromEmail,
        fromName: emailSettings.fromName,
        notificationsEnabled: emailSettings.notificationsEnabled,
        forgotPasswordEnabled: emailSettings.forgotPasswordEnabled,
        testEmailTo: '',
      });
    }
  }, [emailSettings, reset]);

  const saveMutation = useMutation({
    mutationFn: (payload: UpdateTenantEmailSettingsPayload) => settingsApi.updateEmail(payload),
    onSuccess: async () => {
      setFeedback({ type: 'success', message: 'Email configuration saved successfully.' });
      await queryClient.invalidateQueries({ queryKey: ['settings', 'email'] });
    },
    onError: (error: unknown) => {
      setFeedback({
        type: 'danger',
        message: getErrorMessage(error, 'Failed to save email configuration. Please try again.'),
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: (to: string) => settingsApi.sendTestEmail(to),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Test email sent successfully.' });
    },
    onError: (error: unknown) => {
      setFeedback({
        type: 'danger',
        message: getErrorMessage(error, 'Failed to send test email. Check the SMTP details and try again.'),
      });
    },
  });

  const smtpHost = watch('smtpHost');
  const smtpPassword = watch('smtpPassword');
  const encryption = watch('encryption');

  const onSave = handleSubmit(async (values) => {
    clearErrors('testEmailTo');
    setFeedback(null);
    await saveMutation.mutateAsync(buildPayload(values, values.smtpPassword.length > 0));
  });

  const onSendTest = handleSubmit(async (values) => {
    if (!values.testEmailTo.trim()) {
      setError('testEmailTo', { type: 'manual', message: 'Enter a destination email for the test message' });
      return;
    }

    setFeedback(null);
    clearErrors('testEmailTo');
    await saveMutation.mutateAsync(buildPayload(values, values.smtpPassword.length > 0));
    await testMutation.mutateAsync(values.testEmailTo.trim());
  });

  return (
    <>
      <Topbar title="Email Configuration" />
      <div className="space-y-6">
        <SettingsBackLink />

        <PageHeader
          eyebrow="Delivery"
          title="Email configuration"
          titleGradient
          description="Control tenant SMTP delivery, sender identity, and which email flows are allowed to leave the workspace."
          aside={
            <div className="surface-glass flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-accent-600 text-white shadow-sm">
                <Mail className="h-4 w-4" aria-hidden />
              </span>
              SMTP &amp; sender policy
            </div>
          }
        />

        {isLoadError && (
          <Alert variant="danger">
            Failed to load email settings — check that the API is reachable and try refreshing.
          </Alert>
        )}

        {isLoading ? (
          <div className="py-8 text-center text-sm text-slate-500">Loading…</div>
        ) : (
          <form className="space-y-6" onSubmit={onSave} noValidate>
            <Card shadow="sm" className="border-slate-200/90 bg-white/90 backdrop-blur-sm">
              <CardHeader withGradient>
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-100 to-accent-50 ring-1 ring-primary-200/50">
                    <Send className="h-5 w-5 text-primary-700" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">SMTP transport</p>
                    <p className="mt-1 text-sm text-slate-600">
                      Add tenant-specific SMTP details to override the platform mailer for this workspace.
                    </p>
                  </div>
                </div>
              </CardHeader>

              <CardBody className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <Input
                    label="SMTP host"
                    placeholder="smtp.sendgrid.net"
                    error={errors.smtpHost?.message}
                    {...register('smtpHost')}
                  />

                  <Input
                    label="Port"
                    type="number"
                    placeholder="587"
                    error={errors.smtpPort?.message}
                    {...register('smtpPort')}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Encryption</label>
                  <select
                    className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm transition-all focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                    {...register('encryption')}
                  >
                    {ENCRYPTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-xs text-slate-500">
                    {ENCRYPTION_OPTIONS.find((option) => option.value === encryption)?.description}
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Input
                    label="Username"
                    placeholder="apikey or inbox username"
                    error={errors.smtpUsername?.message}
                    {...register('smtpUsername')}
                  />

                  <Input
                    label="Password"
                    type="password"
                    placeholder={emailSettings?.smtpPasswordConfigured ? 'Leave blank to keep the stored password' : 'SMTP password'}
                    hint={
                      emailSettings?.smtpPasswordConfigured && smtpPassword.length === 0
                        ? 'A password is already stored. Enter a new one only if you need to replace it.'
                        : undefined
                    }
                    error={errors.smtpPassword?.message}
                    {...register('smtpPassword')}
                  />
                </div>
              </CardBody>
            </Card>

            <Card shadow="sm" className="border-slate-200/90 bg-white/90 backdrop-blur-sm">
              <CardHeader withGradient>
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent-100 to-warning-50 ring-1 ring-accent-200/50">
                    <ShieldCheck className="h-5 w-5 text-accent-700" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Sender identity &amp; delivery rules</p>
                    <p className="mt-1 text-sm text-slate-600">
                      Decide who the emails appear from and which system emails remain active.
                    </p>
                  </div>
                </div>
              </CardHeader>

              <CardBody className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <Input
                    label="Sender name"
                    placeholder="Acme QA"
                    error={errors.fromName?.message}
                    {...register('fromName')}
                  />

                  <Input
                    label="Sender email"
                    type="email"
                    placeholder="support@acme.com"
                    hint={smtpHost ? 'Required when custom SMTP is enabled.' : 'Optional when using the platform-level sender.'}
                    error={errors.fromEmail?.message}
                    {...register('fromEmail')}
                  />
                </div>

                <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4">
                  <label className="flex items-start gap-4 cursor-pointer">
                    <div className="flex h-6 items-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-primary-600 transition-colors focus:ring-2 focus:ring-primary-500/20"
                        {...register('notificationsEnabled')}
                      />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">Enable notification emails</p>
                      <p className="mt-1.5 text-sm text-slate-600">
                        Allows operational templates such as workflow notifications and tenant events.
                      </p>
                    </div>
                  </label>

                  <div className="border-t border-slate-200/80" />

                  <label className="flex items-start gap-4 cursor-pointer">
                    <div className="flex h-6 items-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-primary-600 transition-colors focus:ring-2 focus:ring-primary-500/20"
                        {...register('forgotPasswordEnabled')}
                      />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">Enable forgot password emails</p>
                      <p className="mt-1.5 text-sm text-slate-600">
                        Keeps the password reset email flow active for users in this workspace.
                      </p>
                    </div>
                  </label>
                </div>
              </CardBody>
            </Card>

            <Card shadow="sm" className="border-slate-200/90 bg-white/90 backdrop-blur-sm">
              <CardHeader withGradient>
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-warning-100 to-primary-50 ring-1 ring-warning-200/60">
                    <Mail className="h-5 w-5 text-warning-700" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Send test email</p>
                    <p className="mt-1 text-sm text-slate-600">
                      Validates the form, saves the current configuration, and sends a test message.
                    </p>
                  </div>
                </div>
              </CardHeader>

              <CardBody className="space-y-4">
                <Input
                  label="Test email recipient"
                  type="email"
                  placeholder="you@company.com"
                  error={errors.testEmailTo?.message}
                  {...register('testEmailTo')}
                />

                <div className="rounded-xl border border-primary-200/70 bg-primary-50/80 px-4 py-3 text-sm text-primary-900">
                  The workspace will use the saved SMTP details. If no tenant SMTP host is set, the platform SMTP fallback will be used when available.
                </div>
              </CardBody>
            </Card>

            {feedback ? <Alert variant={feedback.type}>{feedback.message}</Alert> : null}

            <div className="flex flex-col gap-3 border-t border-slate-200/80 pt-6 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-slate-500">
                {isDirty
                  ? 'You have unsaved email changes.'
                  : 'SMTP, sender identity, and email policy are in sync.'}
              </p>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  type="button"
                  variant="secondary"
                  isLoading={saveMutation.isPending || testMutation.isPending}
                  onClick={onSendTest}
                >
                  <Send className="h-4 w-4" />
                  Send test email
                </Button>

                <Button type="submit" isLoading={saveMutation.isPending} disabled={testMutation.isPending}>
                  Save configuration
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>
    </>
  );
}