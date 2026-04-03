import { BadRequestException, Injectable } from '@nestjs/common';
import { getMasterClient } from '@qa/prisma-master';
import { getEnv } from '@qa/config';
import { TenantConnectionPool } from '../tenant/tenant-connection-pool.service';
import Stripe from 'stripe';

// Plan limits configuration
const PLAN_LIMITS: Record<string, { conversations: number; users: number; forms: number }> = {
  BASIC: { conversations: 500, users: 5, forms: 3 },
  PRO: { conversations: 5000, users: 25, forms: 20 },
  ENTERPRISE: { conversations: -1, users: -1, forms: -1 }, // unlimited = -1
};

@Injectable()
export class BillingService {
  private readonly masterDb = getMasterClient();
  private readonly stripe: Stripe | null;

  constructor(private readonly pool: TenantConnectionPool) {
    const env = getEnv();
    this.stripe = env.STRIPE_SECRET_KEY
      ? new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' })
      : null;
  }

  private getStripeClient(): Stripe {
    if (!this.stripe) {
      throw new BadRequestException({
        code: 'STRIPE_NOT_CONFIGURED',
        message: 'Stripe is not configured for this environment',
      });
    }
    return this.stripe;
  }

  private mapPlanAmountCents(plan: string): number {
    switch (plan) {
      case 'BASIC':
        return 2900;
      case 'PRO':
        return 9900;
      case 'ENTERPRISE':
        return 29900;
      default:
        return 2900;
    }
  }

  private toSubscriptionStatus(status: Stripe.Subscription.Status) {
    if (status === 'trialing') return 'TRIALING' as const;
    if (status === 'active') return 'ACTIVE' as const;
    if (status === 'past_due' || status === 'unpaid' || status === 'incomplete') return 'PAST_DUE' as const;
    if (status === 'canceled' || status === 'incomplete_expired') return 'CANCELLED' as const;
    return 'ACTIVE' as const;
  }

  private toInvoiceStatus(status: Stripe.Invoice.Status | null | undefined) {
    if (status === 'paid') return 'PAID' as const;
    if (status === 'open') return 'OPEN' as const;
    if (status === 'void') return 'VOID' as const;
    if (status === 'uncollectible') return 'UNCOLLECTIBLE' as const;
    return 'DRAFT' as const;
  }

  async createCheckoutSession(
    tenantId: string,
    plan: 'BASIC' | 'PRO' | 'ENTERPRISE',
    successUrl: string,
    cancelUrl: string,
  ) {
    const stripe = this.getStripeClient();

    const tenant = await this.masterDb.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { id: true, name: true, plan: true },
    });

    const existingSubscription = await this.masterDb.subscription.findUnique({
      where: { tenantId },
      select: { id: true, stripeCustomerId: true },
    });

    let customerId = existingSubscription?.stripeCustomerId ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: tenant.name,
        metadata: { tenantId: tenant.id },
      });
      customerId = customer.id;
      await this.masterDb.subscription.update({
        where: { tenantId },
        data: { stripeCustomerId: customerId },
      });
    }

    const amount = this.mapPlanAmountCents(plan);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        tenantId,
        plan,
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            recurring: { interval: 'month' },
            unit_amount: amount,
            product_data: {
              name: `QA Platform ${plan} Plan`,
            },
          },
        },
      ],
    });

    return {
      id: session.id,
      url: session.url,
      plan,
    };
  }

  async changePlan(
    tenantId: string,
    plan: 'BASIC' | 'PRO' | 'ENTERPRISE',
    prorationBehavior: 'create_prorations' | 'always_invoice' | 'none' = 'create_prorations',
  ) {
    const stripe = this.getStripeClient();

    const subscription = await this.masterDb.subscription.findUnique({
      where: { tenantId },
      select: { id: true, stripeSubscriptionId: true },
    });

    if (!subscription?.stripeSubscriptionId) {
      throw new BadRequestException({
        code: 'SUBSCRIPTION_NOT_LINKED',
        message: 'No Stripe subscription is linked to this tenant',
      });
    }

    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const currentItem = stripeSubscription.items.data[0];

    if (!currentItem) {
      throw new BadRequestException({
        code: 'INVALID_STRIPE_SUBSCRIPTION',
        message: 'Stripe subscription has no billable items',
      });
    }

    const price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: this.mapPlanAmountCents(plan),
      recurring: { interval: 'month' },
      product_data: { name: `QA Platform ${plan} Plan` },
      metadata: { tenantId, plan },
    });

    const updated = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      proration_behavior: prorationBehavior,
      items: [{ id: currentItem.id, price: price.id }],
      metadata: {
        ...stripeSubscription.metadata,
        tenantId,
        plan,
      },
    });

    await this.masterDb.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { tenantId },
        data: {
          plan,
          status: this.toSubscriptionStatus(updated.status),
          currentPeriodStart: new Date(updated.current_period_start * 1000),
          currentPeriodEnd: new Date(updated.current_period_end * 1000),
          cancelledAt: updated.cancel_at
            ? new Date(updated.cancel_at * 1000)
            : updated.canceled_at
              ? new Date(updated.canceled_at * 1000)
              : null,
        },
      });

      await tx.tenant.update({
        where: { id: tenantId },
        data: { plan },
      });
    });

    return {
      plan,
      status: this.toSubscriptionStatus(updated.status),
      prorationBehavior,
      currentPeriodEnd: new Date(updated.current_period_end * 1000),
    };
  }

  async cancelSubscription(tenantId: string) {
    const stripe = this.getStripeClient();

    const subscription = await this.masterDb.subscription.findUnique({
      where: { tenantId },
      select: { id: true, stripeSubscriptionId: true },
    });

    if (!subscription?.stripeSubscriptionId) {
      throw new BadRequestException({
        code: 'SUBSCRIPTION_NOT_LINKED',
        message: 'No Stripe subscription is linked to this tenant',
      });
    }

    const updated = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    await this.masterDb.subscription.update({
      where: { tenantId },
      data: {
        status: this.toSubscriptionStatus(updated.status),
        currentPeriodStart: new Date(updated.current_period_start * 1000),
        currentPeriodEnd: new Date(updated.current_period_end * 1000),
        cancelledAt: updated.cancel_at
          ? new Date(updated.cancel_at * 1000)
          : updated.canceled_at
            ? new Date(updated.canceled_at * 1000)
            : null,
      },
    });

    return {
      status: this.toSubscriptionStatus(updated.status),
      cancelAtPeriodEnd: updated.cancel_at_period_end,
      currentPeriodEnd: new Date(updated.current_period_end * 1000),
      cancelledAt: updated.cancel_at
        ? new Date(updated.cancel_at * 1000)
        : updated.canceled_at
          ? new Date(updated.canceled_at * 1000)
          : null,
    };
  }

  async resumeSubscription(tenantId: string) {
    const stripe = this.getStripeClient();

    const subscription = await this.masterDb.subscription.findUnique({
      where: { tenantId },
      select: { id: true, stripeSubscriptionId: true },
    });

    if (!subscription?.stripeSubscriptionId) {
      throw new BadRequestException({
        code: 'SUBSCRIPTION_NOT_LINKED',
        message: 'No Stripe subscription is linked to this tenant',
      });
    }

    const updated = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    await this.masterDb.subscription.update({
      where: { tenantId },
      data: {
        status: this.toSubscriptionStatus(updated.status),
        currentPeriodStart: new Date(updated.current_period_start * 1000),
        currentPeriodEnd: new Date(updated.current_period_end * 1000),
        cancelledAt: null,
      },
    });

    return {
      status: this.toSubscriptionStatus(updated.status),
      cancelAtPeriodEnd: updated.cancel_at_period_end,
      currentPeriodEnd: new Date(updated.current_period_end * 1000),
      cancelledAt: null,
    };
  }

  async createPortalSession(tenantId: string, returnUrl: string) {
    const stripe = this.getStripeClient();

    const subscription = await this.masterDb.subscription.findUnique({
      where: { tenantId },
      select: { stripeCustomerId: true },
    });

    if (!subscription?.stripeCustomerId) {
      throw new BadRequestException({
        code: 'CUSTOMER_NOT_LINKED',
        message: 'No Stripe customer is linked to this tenant',
      });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: returnUrl,
    });

    return {
      url: session.url,
    };
  }

  async handleStripeWebhook(signature: string | undefined, rawBody: Buffer) {
    const stripe = this.getStripeClient();
    const env = getEnv();

    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw new BadRequestException({
        code: 'STRIPE_NOT_CONFIGURED',
        message: 'Stripe webhook secret is not configured',
      });
    }

    if (!signature) {
      throw new BadRequestException({
        code: 'INVALID_STRIPE_SIGNATURE',
        message: 'Missing Stripe signature header',
      });
    }

    const event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);

    const existing = await this.masterDb.stripeWebhookEvent.findUnique({
      where: { stripeEventId: event.id },
      select: { id: true, status: true },
    });

    if (existing?.status === 'PROCESSED') {
      return { received: true, eventType: event.type, duplicate: true };
    }

    if (existing?.status === 'PROCESSING') {
      return { received: true, eventType: event.type, inProgress: true };
    }

    const eventRow = existing
      ? await this.masterDb.stripeWebhookEvent.update({
          where: { id: existing.id },
          data: {
            status: 'PROCESSING',
            attempts: { increment: 1 },
            lastError: null,
          },
          select: { id: true },
        })
      : await this.masterDb.stripeWebhookEvent.create({
          data: {
            stripeEventId: event.id,
            eventType: event.type,
            status: 'PROCESSING',
          },
          select: { id: true },
        });

    try {
      await this.processStripeEvent(event);

      await this.masterDb.stripeWebhookEvent.update({
        where: { id: eventRow.id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          lastError: null,
        },
      });
    } catch (err: unknown) {
      await this.masterDb.stripeWebhookEvent.update({
        where: { id: eventRow.id },
        data: {
          status: 'FAILED',
          lastError: (err as Error).message,
        },
      });
      throw err;
    }

    return { received: true, eventType: event.type };
  }

  private async processStripeEvent(event: Stripe.Event): Promise<void> {

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const tenantId = session.metadata?.tenantId;
      const plan = session.metadata?.plan as 'BASIC' | 'PRO' | 'ENTERPRISE' | undefined;

      if (tenantId && session.subscription && session.customer && plan) {
        await this.masterDb.$transaction(async (tx) => {
          await tx.subscription.update({
            where: { tenantId },
            data: {
              plan,
              status: 'ACTIVE',
              stripeSubscriptionId: String(session.subscription),
              stripeCustomerId: String(session.customer),
            },
          });
          await tx.tenant.update({
            where: { id: tenantId },
            data: { plan },
          });
        });
      }
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created' || event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      await this.masterDb.subscription.updateMany({
        where: { stripeSubscriptionId: sub.id },
        data: {
          status: this.toSubscriptionStatus(sub.status),
          currentPeriodStart: new Date(sub.current_period_start * 1000),
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
          cancelledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
        },
      });
    }

    if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice.payment_failed') {
      const inv = event.data.object as Stripe.Invoice;
      const subscriptionId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id;
      const amount = inv.amount_paid || inv.amount_due || 0;

      if (!subscriptionId) {
        return;
      }

      await this.masterDb.invoice.upsert({
        where: { stripeInvoiceId: inv.id },
        create: {
          subscription: {
            connect: { stripeSubscriptionId: subscriptionId },
          },
          amount,
          currency: (inv.currency ?? 'usd').toUpperCase(),
          status: this.toInvoiceStatus(inv.status),
          stripeInvoiceId: inv.id,
          paidAt: inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000) : null,
          dueAt: inv.due_date ? new Date(inv.due_date * 1000) : new Date(),
        },
        update: {
          amount,
          currency: (inv.currency ?? 'usd').toUpperCase(),
          status: this.toInvoiceStatus(inv.status),
          paidAt: inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000) : null,
          dueAt: inv.due_date ? new Date(inv.due_date * 1000) : new Date(),
        },
      });

      await this.masterDb.subscription.updateMany({
        where: { stripeSubscriptionId: subscriptionId },
        data: {
          status: event.type === 'invoice.payment_failed' ? 'PAST_DUE' : 'ACTIVE',
        },
      });
    }
  }

  async getSubscription(tenantId: string) {
    const [tenant, subscription, invoices] = await Promise.all([
      this.masterDb.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { id: true, name: true, plan: true, status: true },
      }),
      this.masterDb.subscription.findUnique({
        where: { tenantId },
        select: {
          id: true,
          plan: true,
          status: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          trialEndsAt: true,
          cancelledAt: true,
          createdAt: true,
        },
      }),
      this.masterDb.invoice.findMany({
        where: { subscription: { tenantId } },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: {
          id: true,
          amount: true,
          currency: true,
          status: true,
          paidAt: true,
          dueAt: true,
          createdAt: true,
        },
      }),
    ]);

    return { tenant, subscription, invoices };
  }

  async getUsage(tenantId: string) {
    const tenant = await this.masterDb.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { plan: true },
    });

    // Current period usage
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const [usageMetric, userCount] = await Promise.all([
      this.masterDb.usageMetric.findFirst({
        where: {
          tenantId,
          periodStart: { lte: now },
          periodEnd: { gte: now },
        },
        select: {
          conversationsProcessed: true,
          aiTokensUsed: true,
          aiCostCents: true,
          activeUsers: true,
          periodStart: true,
          periodEnd: true,
        },
      }),
      this.masterDb.user.count({ where: { tenantId, status: { not: 'INACTIVE' } } }),
    ]);

    // Count forms from tenant DB
    let formCount = 0;
    try {
      const db = await this.pool.getClient(tenantId);
      formCount = await db.formDefinition.count({
        where: { status: { not: 'ARCHIVED' } },
      });
    } catch {
      // tenant DB may not be available, default to 0
    }

    const limits = PLAN_LIMITS[tenant.plan] ?? PLAN_LIMITS.BASIC;

    return {
      period: {
        start: usageMetric?.periodStart ?? periodStart,
        end: usageMetric?.periodEnd ?? periodEnd,
      },
      conversations: {
        used: usageMetric?.conversationsProcessed ?? 0,
        limit: limits.conversations,
      },
      users: {
        used: userCount,
        limit: limits.users,
      },
      forms: {
        used: formCount,
        limit: limits.forms,
      },
      ai: {
        tokensUsed: Number(usageMetric?.aiTokensUsed ?? 0),
        costCents: usageMetric?.aiCostCents ?? 0,
      },
      plan: tenant.plan,
    };
  }
}
