'use client';

import { Suspense, useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Topbar } from '@/components/layout/topbar';
import { billingApi, type BillingSubscription, type BillingUsage } from '@/lib/api';
import { CreditCard, TrendingUp, AlertTriangle } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { useQueryClient } from '@tanstack/react-query';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatCurrency(cents: number, currency = 'USD') {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency });
}

const STATUS_BADGE: Record<string, string> = {
  TRIALING: 'bg-blue-100 text-blue-700',
  ACTIVE: 'bg-green-100 text-green-700',
  PAST_DUE: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-600',
  EXPIRED: 'bg-slate-100 text-slate-600',
};

const INVOICE_STATUS_BADGE: Record<string, string> = {
  PAID: 'bg-green-100 text-green-700',
  OPEN: 'bg-yellow-100 text-yellow-700',
  DRAFT: 'bg-slate-100 text-slate-500',
  VOID: 'bg-slate-100 text-slate-400',
  UNCOLLECTIBLE: 'bg-red-100 text-red-600',
};

const PLAN_BADGE: Record<string, string> = {
  BASIC: 'bg-slate-100 text-slate-700',
  PRO: 'bg-indigo-100 text-indigo-700',
  ENTERPRISE: 'bg-purple-100 text-purple-700',
};

// ─── Usage bar ────────────────────────────────────────────────────────────────

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const unlimited = limit === -1;
  const pct = unlimited ? 0 : Math.min(100, (used / limit) * 100);
  const near = pct >= 80;
  const over = pct >= 100;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium text-slate-800">{label}</span>
        <span className={`text-xs ${over ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
          {used.toLocaleString()} / {unlimited ? '∞' : limit.toLocaleString()}
        </span>
      </div>
      {!unlimited && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-2 rounded-full transition-all ${
              over ? 'bg-red-500' : near ? 'bg-yellow-500' : 'bg-blue-500'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {unlimited && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-2 w-full rounded-full bg-green-400 opacity-40" />
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function BillingPageContent() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const checkoutStatus = searchParams.get('checkout');
  const [prorationBehavior, setProrationBehavior] = useState<
    'create_prorations' | 'always_invoice' | 'none'
  >('create_prorations');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!checkoutStatus) {
      return;
    }

    queryClient.invalidateQueries({ queryKey: ['billing'] });
    queryClient.invalidateQueries({ queryKey: ['billing-usage'] });

    const timeout = window.setTimeout(() => {
      router.replace(pathname);
    }, 7000);

    return () => window.clearTimeout(timeout);
  }, [checkoutStatus, pathname, queryClient, router]);

  const {
    data: billing,
    isLoading: billingLoading,
    isFetching: billingFetching,
    isError: billingError,
  } = useQuery<BillingSubscription>({
    queryKey: ['billing'],
    queryFn: () => billingApi.getSubscription(),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const {
    data: usage,
    isLoading: usageLoading,
    isFetching: usageFetching,
  } = useQuery<BillingUsage>({
    queryKey: ['billing-usage'],
    queryFn: () => billingApi.getUsage(),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const isRefreshing = billingFetching || usageFetching;

  const sub = billing?.subscription;
  const checkoutMutation = useMutation({
    mutationFn: async (plan: 'BASIC' | 'PRO' | 'ENTERPRISE') => {
      const origin =
        typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001';
      const result = await billingApi.createCheckoutSession({
        plan,
        successUrl: `${origin}/billing?checkout=success`,
        cancelUrl: `${origin}/billing?checkout=cancelled`,
      });

      if (!result.url) {
        throw new Error('Missing checkout URL from server');
      }

      if (typeof window !== 'undefined') {
        window.location.href = result.url;
      }

      return result;
    },
  });

  const changePlanMutation = useMutation({
    mutationFn: (payload: {
      plan: 'BASIC' | 'PRO' | 'ENTERPRISE';
      prorationBehavior: 'create_prorations' | 'always_invoice' | 'none';
    }) => billingApi.changePlan(payload),
    onSuccess: (result) => {
      setActionMessage(
        `Plan switched to ${result.plan}. Proration mode: ${result.prorationBehavior}.`,
      );
      queryClient.invalidateQueries({ queryKey: ['billing'] });
      queryClient.invalidateQueries({ queryKey: ['billing-usage'] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => billingApi.cancelSubscription(),
    onSuccess: () => {
      setActionMessage('Subscription will cancel at the end of the current period.');
      queryClient.invalidateQueries({ queryKey: ['billing'] });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: () => billingApi.resumeSubscription(),
    onSuccess: () => {
      setActionMessage('Subscription resumed. Automatic renewal is now active.');
      queryClient.invalidateQueries({ queryKey: ['billing'] });
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const origin =
        typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001';
      const result = await billingApi.createPortalSession({
        returnUrl: `${origin}/billing`,
      });

      if (!result.url) {
        throw new Error('Missing customer portal URL from server');
      }

      if (typeof window !== 'undefined') {
        window.location.href = result.url;
      }

      return result;
    },
  });

  const runPlanChange = (plan: 'BASIC' | 'PRO' | 'ENTERPRISE') => {
    if (sub) {
      changePlanMutation.mutate({ plan, prorationBehavior });
      return;
    }
    checkoutMutation.mutate(plan);
  };

  const isNearLimit =
    usage &&
    ((usage.conversations.limit !== -1 &&
      usage.conversations.used / usage.conversations.limit >= 0.8) ||
      (usage.users.limit !== -1 && usage.users.used / usage.users.limit >= 0.8) ||
      (usage.forms.limit !== -1 && usage.forms.used / usage.forms.limit >= 0.8));

  return (
    <>
      <Topbar title="Billing" />
      <div className="max-w-4xl space-y-4">
        {/* Page header */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.05)]">
          <div className="flex items-center gap-3 bg-gradient-to-r from-slate-50 to-white px-5 py-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-100">
              <CreditCard className="h-5 w-5 text-accent-700" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Billing</h1>
              <p className="text-sm text-slate-500">Manage your subscription and usage</p>
            </div>
          </div>
        </div>

        {checkoutStatus === 'success' && (
          <Alert variant="success">
            Checkout completed. Stripe will update your subscription shortly.
          </Alert>
        )}
        {checkoutStatus === 'cancelled' && (
          <Alert variant="warning">
            Checkout was cancelled. Your current plan remains unchanged.
          </Alert>
        )}
        {actionMessage && <Alert variant="success">{actionMessage}</Alert>}

        {billingError && <Alert variant="danger">Failed to load billing information.</Alert>}

        {isRefreshing && !billingLoading && !usageLoading && (
          <Alert variant="info">Updating billing data...</Alert>
        )}

        {/* Usage near limit warning */}
        {isNearLimit && (
          <Alert variant="warning">
            <AlertTriangle className="mr-2 inline h-4 w-4" />
            You are approaching your plan limits. Consider upgrading to avoid interruption.
          </Alert>
        )}

        {sub?.status === 'PAST_DUE' && (
          <Alert variant="warning">
            Payment is past due. Update your payment method or retry collection from Stripe billing
            portal.
            <button
              className="ml-3 rounded-md border border-yellow-300 bg-yellow-50 px-2.5 py-1 text-xs font-semibold text-yellow-800 hover:bg-yellow-100 disabled:opacity-60"
              onClick={() => portalMutation.mutate()}
              disabled={portalMutation.isPending}
            >
              {portalMutation.isPending ? 'Opening portal...' : 'Retry Payment'}
            </button>
          </Alert>
        )}

        {/* Subscription card */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.05)]">
          <div className="flex items-center gap-3 bg-gradient-to-r from-slate-50 to-white px-5 py-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-100">
              <CreditCard className="h-5 w-5 text-accent-700" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">Subscription</h2>
              <p className="text-xs text-slate-500">Current plan and billing period</p>
            </div>
          </div>

          <div className="px-5 py-4">
            {billingLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-5 w-64 animate-pulse rounded bg-slate-100" />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-slate-500">Plan</p>
                    <span
                      className={`mt-1 inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-semibold ${
                        PLAN_BADGE[billing?.tenant.plan ?? ''] ?? 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {billing?.tenant.plan ?? '—'}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Status</p>
                    {sub ? (
                      <span
                        className={`mt-1 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          STATUS_BADGE[sub.status] ?? 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {sub.status.replace(/_/g, ' ')}
                      </span>
                    ) : (
                      <p className="mt-1 text-sm text-slate-400">No subscription</p>
                    )}
                  </div>
                  {sub && (
                    <>
                      <div>
                        <p className="text-xs text-slate-500">Current period</p>
                        <p className="mt-1 text-sm text-slate-700">
                          {formatDate(sub.currentPeriodStart)} – {formatDate(sub.currentPeriodEnd)}
                        </p>
                      </div>
                      {sub.trialEndsAt && (
                        <div>
                          <p className="text-xs text-slate-500">Trial ends</p>
                          <p className="mt-1 text-sm text-slate-700">
                            {formatDate(sub.trialEndsAt)}
                          </p>
                        </div>
                      )}
                      {sub.cancelledAt && (
                        <div>
                          <p className="text-xs text-slate-500">Cancelled on</p>
                          <p className="mt-1 text-sm text-red-600">{formatDate(sub.cancelledAt)}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs text-slate-500">Member since</p>
                        <p className="mt-1 text-sm text-slate-700">{formatDate(sub.createdAt)}</p>
                      </div>
                    </>
                  )}
                </div>

                <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                  <p className="text-sm font-medium text-slate-800">Manage Plan</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Start or switch your Stripe subscription plan.
                  </p>
                  {sub && (
                    <div className="mt-3 max-w-sm">
                      <label className="block text-xs font-medium text-slate-700">
                        Proration behavior
                      </label>
                      <select
                        value={prorationBehavior}
                        onChange={(e) =>
                          setProrationBehavior(
                            e.target.value as 'create_prorations' | 'always_invoice' | 'none',
                          )
                        }
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                      >
                        <option value="create_prorations">Create prorations on next invoice</option>
                        <option value="always_invoice">Invoice proration immediately</option>
                        <option value="none">No proration adjustments</option>
                      </select>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(['BASIC', 'PRO', 'ENTERPRISE'] as const).map((plan) => {
                      const isCurrent = billing?.tenant.plan === plan;
                      return (
                        <button
                          key={plan}
                          disabled={checkoutMutation.isPending || changePlanMutation.isPending}
                          onClick={() => runPlanChange(plan)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                            isCurrent
                              ? 'bg-slate-900 text-white'
                              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {checkoutMutation.isPending || changePlanMutation.isPending
                            ? 'Processing...'
                            : isCurrent
                              ? `${plan} (Current)`
                              : `Switch to ${plan}`}
                        </button>
                      );
                    })}
                  </div>
                  {sub && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {sub.cancelledAt ? (
                        <button
                          disabled={resumeMutation.isPending}
                          onClick={() => resumeMutation.mutate()}
                          className="rounded-lg px-3 py-1.5 text-xs font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-60"
                        >
                          {resumeMutation.isPending ? 'Resuming...' : 'Resume Subscription'}
                        </button>
                      ) : (
                        <button
                          disabled={cancelMutation.isPending}
                          onClick={() => cancelMutation.mutate()}
                          className="rounded-lg px-3 py-1.5 text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                        >
                          {cancelMutation.isPending ? 'Cancelling...' : 'Cancel At Period End'}
                        </button>
                      )}
                    </div>
                  )}
                  {checkoutMutation.isError && (
                    <p className="mt-2 text-xs text-red-600">
                      Failed to create checkout session. Ensure Stripe keys are configured.
                    </p>
                  )}
                  {changePlanMutation.isError && (
                    <p className="mt-2 text-xs text-red-600">
                      Failed to change plan in Stripe. If this is your first subscription, start
                      checkout first.
                    </p>
                  )}
                  {(cancelMutation.isError || resumeMutation.isError) && (
                    <p className="mt-2 text-xs text-red-600">
                      Failed to update subscription state. Please try again.
                    </p>
                  )}
                  {portalMutation.isError && (
                    <p className="mt-2 text-xs text-red-600">
                      Failed to open Stripe billing portal. Please verify Stripe customer linkage.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Usage card */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.05)]">
          <div className="flex items-center gap-3 bg-gradient-to-r from-slate-50 to-white px-5 py-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success-100">
              <TrendingUp className="h-5 w-5 text-success-700" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">Usage</h2>
              <p className="text-xs text-slate-500">
                {usage
                  ? `Period: ${formatDate(usage.period.start)} – ${formatDate(usage.period.end)}`
                  : 'Current billing period'}
              </p>
            </div>
          </div>

          <div className="px-5 py-4">
            {usageLoading ? (
              <div className="space-y-5">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="space-y-1">
                    <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
                    <div className="h-2 w-full animate-pulse rounded bg-slate-100" />
                  </div>
                ))}
              </div>
            ) : usage ? (
              <div className="space-y-5">
                <UsageBar
                  label="Conversations processed"
                  used={usage.conversations.used}
                  limit={usage.conversations.limit}
                />
                <UsageBar label="Active users" used={usage.users.used} limit={usage.users.limit} />
                <UsageBar label="Forms" used={usage.forms.used} limit={usage.forms.limit} />

                {/* AI cost */}
                <div className="rounded-lg bg-slate-50 px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-800">AI tokens used</p>
                    <p className="text-xs text-slate-500">
                      {usage.ai.tokensUsed.toLocaleString()} tokens
                    </p>
                  </div>
                  <p className="text-lg font-semibold text-slate-900">
                    {formatCurrency(usage.ai.costCents)}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">No usage data available.</p>
            )}
          </div>
        </div>

        {/* Invoices */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.05)]">
          <div className="border-b border-slate-100 px-6 py-4">
            <h2 className="font-semibold text-slate-900">Invoice history</h2>
          </div>
          {billingLoading ? (
            <div className="px-6 py-6 text-center text-sm text-slate-400">Loading…</div>
          ) : !billing?.invoices || billing.invoices.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-slate-400">No invoices yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                  <tr>
                    <th className="px-6 py-3 text-left font-medium">Date</th>
                    <th className="px-6 py-3 text-left font-medium">Due</th>
                    <th className="px-6 py-3 text-right font-medium">Amount</th>
                    <th className="px-6 py-3 text-center font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {billing.invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50">
                      <td className="px-6 py-3 text-slate-700">{formatDate(inv.createdAt)}</td>
                      <td className="px-6 py-3 text-slate-500">{formatDate(inv.dueAt)}</td>
                      <td className="px-6 py-3 text-right font-mono text-slate-800">
                        {formatCurrency(inv.amount, inv.currency)}
                      </td>
                      <td className="px-6 py-3 text-center">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            INVOICE_STATUS_BADGE[inv.status] ?? 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {inv.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={null}>
      <BillingPageContent />
    </Suspense>
  );
}
