'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Zap,
  EyeOff,
  AlertTriangle,
  ChevronRight,
  Key,
  Copy,
  Check,
  RefreshCw,
  Globe,
  Mail,
} from 'lucide-react';
import { api } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Topbar } from '@/components/layout/topbar';
import { PageHeader } from '@/components/layout/page-header';

const SETTINGS_SECTIONS = [
  {
    href: '/settings/llm',
    icon: Zap,
    title: 'LLM Configuration',
    description: 'Connect an AI model to power automated QA evaluations.',
  },
  {
    href: '/settings/blind-review',
    icon: EyeOff,
    title: 'Blind Review',
    description: 'Hide agent identity from QA reviewers and QA scores from verifiers.',
  },
  {
    href: '/settings/escalation',
    icon: AlertTriangle,
    title: 'Escalation Rules',
    description: 'Configure deviation thresholds that trigger automatic escalation.',
  },
  {
    href: '/settings/webhooks',
    icon: Globe,
    title: 'Outbound Webhooks',
    description: 'Push signed evaluation events to your external systems.',
  },
  {
    href: '/settings/email',
    icon: Mail,
    title: 'Email Configuration',
    description: 'Set SMTP delivery, sender identity, and which email flows stay active.',
  },
];

function ApiKeyManager() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const rotateMutation = useMutation({
    mutationFn: () => api.post<{ apiKey: string }>('/settings/api-keys/rotate').then((r) => r.data),
    onSuccess: (data) => {
      setApiKey(data.apiKey);
      setCopied(false);
    },
  });

  const handleCopy = () => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card shadow="sm">
      <CardHeader withGradient>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 shadow-md shadow-primary-500/20 ring-2 ring-white/80">
            <Key className="h-5 w-5 text-white drop-shadow-sm" />
          </div>
          <div>
            <p className="font-semibold text-slate-900">Webhook API Key</p>
            <p className="mt-1 text-sm text-slate-600">
              Use this key with{' '}
              <code className="rounded bg-slate-100 px-1 text-xs font-mono">X-Api-Key</code> header
              to POST conversations to{' '}
              <code className="rounded bg-slate-100 px-1 text-xs font-mono">
                POST /api/v1/webhooks/ingest
              </code>
            </p>
          </div>
        </div>
      </CardHeader>

      <CardBody>
        {apiKey && (
          <div className="mb-4">
            <Alert variant="warning">
              <strong>Copy this key now</strong> — it will not be shown again.
            </Alert>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2">
              <code className="flex-1 break-all font-mono text-xs text-primary-800">{apiKey}</code>
              <button
                onClick={handleCopy}
                className="flex-shrink-0 rounded p-1.5 transition-colors hover:bg-primary-100"
                title="Copy"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-success-600" />
                ) : (
                  <Copy className="h-4 w-4 text-primary-600" />
                )}
              </button>
            </div>
          </div>
        )}

        {rotateMutation.isError && (
          <Alert variant="danger" className="mb-3">
            Failed to generate key. Try again.
          </Alert>
        )}

        <button
          onClick={() => rotateMutation.mutate()}
          disabled={rotateMutation.isPending}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${rotateMutation.isPending ? 'animate-spin' : ''}`} />
          {apiKey ? 'Rotate key' : 'Generate API key'}
        </button>
      </CardBody>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <>
      <Topbar title="Settings" />
      <div className="space-y-6">
        <PageHeader
          eyebrow="Workspace"
          title="Settings"
          titleGradient
          description="LLM, blind review, escalation, webhooks, and API access — tuned to how your team reviews."
        />

        <div className="space-y-3">
          {SETTINGS_SECTIONS.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="group flex items-center gap-4 rounded-2xl border border-slate-200/90 bg-white/90 px-5 py-4 shadow-xs backdrop-blur-sm transition-all duration-base hover:-translate-y-0.5 hover:border-primary-200/80 hover:bg-white hover:shadow-lg hover:shadow-primary-500/[0.06]"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-100 to-primary-50 ring-1 ring-primary-200/40 transition-all group-hover:from-primary-200 group-hover:to-primary-100">
                <section.icon className="h-5 w-5 text-primary-700" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-slate-900">{section.title}</p>
                <p className="mt-0.5 text-sm text-slate-600">{section.description}</p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>

        <ApiKeyManager />
      </div>
    </>
  );
}
