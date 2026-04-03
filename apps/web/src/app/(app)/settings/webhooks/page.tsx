'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Globe, Plus, Trash2, RefreshCw, Copy, Check, ToggleLeft, ToggleRight } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Topbar } from '@/components/layout/topbar';
import { PageHeader, SettingsBackLink } from '@/components/layout/page-header';

type WebhookEvent = 'evaluation.completed' | 'evaluation.escalated' | 'evaluation.failed';
type WebhookStatus = 'ACTIVE' | 'INACTIVE';

interface OutboundWebhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  status: WebhookStatus;
  createdAt: string;
  updatedAt: string;
}

interface CreateResult extends OutboundWebhook {
  secret: string;
}

const ALL_EVENTS: { value: WebhookEvent; label: string }[] = [
  { value: 'evaluation.completed', label: 'Evaluation Completed' },
  { value: 'evaluation.escalated', label: 'Evaluation Escalated' },
  { value: 'evaluation.failed', label: 'Evaluation Failed (AI error)' },
];

function SecretDisplay({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(secret).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Card shadow="sm" className="border-l-4 border-l-warning-500">
      <CardBody className="bg-warning-50">
        <p className="text-sm font-semibold text-warning-900 mb-3">
          💾 Save this signing secret — it will only be shown once.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 break-all rounded bg-white px-3 py-2 text-xs font-mono text-slate-800 border border-warning-200">
            {secret}
          </code>
          <button
            onClick={copy}
            className="shrink-0 rounded p-2 text-warning-700 transition-colors hover:bg-warning-100"
            title="Copy"
          >
            {copied ? <Check className="h-4 w-4 text-success-600" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </CardBody>
    </Card>
  );
}

function CreateWebhookForm({ onCreated }: { onCreated: (secret: string) => void }) {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>(['evaluation.completed']);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post<CreateResult>('/outbound-webhooks', { url, events }).then((r) => r.data),
    onSuccess: (data) => {
      onCreated(data.secret);
      setUrl('');
      setEvents(['evaluation.completed']);
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Failed to create webhook';
      setError(msg);
    },
  });

  const toggleEvent = (ev: WebhookEvent) => {
    setEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev],
    );
  };

  return (
    <Card shadow="sm" className="border-slate-200/90 bg-white/90 backdrop-blur-sm">
      <CardHeader withGradient>
        <h2 className="text-lg font-semibold text-slate-900">Register new endpoint</h2>
      </CardHeader>
      <CardBody className="space-y-4">
        {error && (
          <Alert variant="danger">{error}</Alert>
        )}

        <Input
          label="Endpoint URL"
          placeholder="https://your-system.example.com/webhook"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setError(''); }}
        />

        <div>
          <p className="mb-3 text-sm font-semibold text-slate-900">Events to subscribe</p>
          <div className="space-y-2">
            {ALL_EVENTS.map((ev) => (
              <label key={ev.value} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={events.includes(ev.value)}
                  onChange={() => toggleEvent(ev.value)}
                  className="rounded border-slate-300 text-primary-600 transition-colors focus:ring-2 focus:ring-primary-500/20"
                />
                <span className="text-sm font-medium text-slate-900">{ev.label}</span>
                <code className="ml-auto text-xs text-slate-500">{ev.value}</code>
              </label>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100">
          <Button
            onClick={() => mutation.mutate()}
            disabled={!url || events.length === 0 || mutation.isPending}
            className="w-full"
          >
            {mutation.isPending ? 'Registering…' : 'Register Endpoint'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function WebhookRow({
  hook,
  onRotated,
  onDeleted,
  onToggled,
}: {
  hook: OutboundWebhook;
  onRotated: (secret: string) => void;
  onDeleted: () => void;
  onToggled: () => void;
}) {
  const [rotating, setRotating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);

  const rotate = async () => {
    setRotating(true);
    try {
      const { data } = await api.post<{ secret: string }>(`/outbound-webhooks/${hook.id}/rotate-secret`);
      onRotated(data.secret);
    } finally {
      setRotating(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete webhook for ${hook.url}?`)) return;
    setDeleting(true);
    try {
      await api.delete(`/outbound-webhooks/${hook.id}`);
      onDeleted();
    } finally {
      setDeleting(false);
    }
  };

  const toggleStatus = async () => {
    setToggling(true);
    try {
      await api.patch(`/outbound-webhooks/${hook.id}/status`, {
        status: hook.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      });
      onToggled();
    } finally {
      setToggling(false);
    }
  };

  return (
    <Card shadow="xs" className="border-slate-200/90 bg-white/90 transition-all duration-base hover:border-primary-200/60 hover:shadow-md">
      <CardBody className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent-50 to-primary-50 ring-1 ring-accent-100">
            <Globe className="h-4 w-4 text-accent-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{hook.url}</p>
            <p className="text-xs text-slate-600 mt-1">
              {hook.events.join(' • ')}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                hook.status === 'ACTIVE'
                  ? 'bg-success-100 text-success-700'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {hook.status}
            </span>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
          <button
            onClick={toggleStatus}
            disabled={toggling}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100"
            title={hook.status === 'ACTIVE' ? 'Disable' : 'Enable'}
          >
            {hook.status === 'ACTIVE' ? (
              <ToggleRight className="h-4 w-4 text-success-600" />
            ) : (
              <ToggleLeft className="h-4 w-4 text-slate-400" />
            )}
            <span>{hook.status === 'ACTIVE' ? 'Disable' : 'Enable'}</span>
          </button>

          <button
            onClick={rotate}
            disabled={rotating}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100"
            title="Rotate signing secret"
          >
            <RefreshCw className={`h-4 w-4 ${rotating ? 'animate-spin' : ''}`} />
            <span>Rotate secret</span>
          </button>

          <button
            onClick={remove}
            disabled={deleting}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-danger-700 transition-colors hover:bg-danger-50"
            title="Delete webhook"
          >
            <Trash2 className="h-4 w-4" />
            <span>Delete</span>
          </button>
        </div>
      </CardBody>
    </Card>
  );
}

export default function OutboundWebhooksPage() {
  const qc = useQueryClient();
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);

  const { data: hooks = [], isLoading } = useQuery({
    queryKey: ['outbound-webhooks'],
    queryFn: () => api.get<OutboundWebhook[]>('/outbound-webhooks').then((r) => r.data),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['outbound-webhooks'] });

  return (
    <>
      <Topbar title="Outbound Webhooks" />
      <div className="space-y-6">
        <SettingsBackLink />

        <PageHeader
          eyebrow="Integrations"
          title="Outbound webhooks"
          titleGradient
          description="Signed HTTP POSTs when evaluations complete, escalate, or fail."
          aside={
            <div className="surface-glass flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-500 to-primary-600 text-white shadow-sm">
                <Globe className="h-4 w-4" aria-hidden />
              </span>
              HMAC-ready
            </div>
          }
        />

        <Card shadow="xs" className="border-slate-200/80 bg-white/80 backdrop-blur-sm">
          <CardBody className="text-sm text-slate-600">
            Verify the{' '}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono text-slate-800">
              X-QA-Signature
            </code>{' '}
            header with HMAC-SHA256 and your signing secret on each payload.
          </CardBody>
        </Card>

        <CreateWebhookForm
          onCreated={(secret) => {
            setNewSecret(secret);
            setRotatedSecret(null);
            refresh();
          }}
        />

        {newSecret && <SecretDisplay secret={newSecret} />}
        {rotatedSecret && <SecretDisplay secret={rotatedSecret} />}

        <div>
          <h2 className="mb-4 text-2xs font-bold uppercase tracking-[0.15em] text-slate-500">
            Registered endpoints ({hooks.length})
          </h2>

          {isLoading && (
            <p className="text-sm text-slate-600">Loading…</p>
          )}

          {!isLoading && hooks.length === 0 && (
            <Card shadow="xs" className="border-dashed border-slate-300 bg-slate-50/50">
              <CardBody className="text-center py-8">
                <Globe className="mx-auto mb-3 h-8 w-8 text-slate-400" />
                <p className="text-sm font-medium text-slate-700">No endpoints registered yet.</p>
              </CardBody>
            </Card>
          )}

          {!isLoading && hooks.length > 0 && (
            <div className="space-y-3">
              {hooks.map((hook) => (
                <WebhookRow
                  key={hook.id}
                  hook={hook}
                  onRotated={(secret) => {
                    setRotatedSecret(secret);
                    setNewSecret(null);
                    refresh();
                  }}
                  onDeleted={refresh}
                  onToggled={refresh}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}


