jest.mock('@qa/prisma-master', () => ({
  getMasterClient: jest.fn(() => mockDb),
}));

jest.mock('@qa/config', () => ({
  getEnv: jest.fn(() => mockEnv),
}));

const mockStripeClient = {
  customers: { create: jest.fn() },
  checkout: { sessions: { create: jest.fn() } },
  subscriptions: { retrieve: jest.fn(), update: jest.fn() },
  billingPortal: { sessions: { create: jest.fn() } },
  prices: { create: jest.fn() },
  webhooks: { constructEvent: jest.fn() },
};

const mockStripeCtor = jest.fn(() => mockStripeClient);

jest.mock('stripe', () => ({
  __esModule: true,
  default: mockStripeCtor,
}));

let mockEnv: {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
};

let mockDb: {
  tenant: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
  subscription: {
    findUnique: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  invoice: { upsert: jest.Mock };
  stripeWebhookEvent: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  $transaction: jest.Mock;
};

import { BadRequestException } from '@nestjs/common';
import { BillingService } from './billing.service';

describe('BillingService (Stripe flows)', () => {
  let service: BillingService;

  beforeEach(() => {
    mockEnv = {
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_WEBHOOK_SECRET: 'whsec_123',
    };

    mockDb = {
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'tenant-1', name: 'Acme', plan: 'BASIC' }),
        update: jest.fn().mockResolvedValue({}),
      },
      subscription: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sub-row', stripeCustomerId: null }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      invoice: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      stripeWebhookEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'evt-row-1' }),
        update: jest.fn().mockResolvedValue({ id: 'evt-row-1' }),
      },
      $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          subscription: { update: jest.fn().mockResolvedValue({}) },
          tenant: { update: jest.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      }),
    };

    mockStripeCtor.mockClear();
    mockStripeClient.customers.create.mockReset().mockResolvedValue({ id: 'cus_123' });
    mockStripeClient.checkout.sessions.create.mockReset().mockResolvedValue({ id: 'cs_123', url: 'https://checkout.stripe.com/cs_123' });
    mockStripeClient.billingPortal.sessions.create.mockReset().mockResolvedValue({
      id: 'bps_123',
      url: 'https://billing.stripe.com/session/test',
    });
    mockStripeClient.prices.create.mockReset().mockResolvedValue({ id: 'price_new_123' });
    mockStripeClient.subscriptions.retrieve.mockReset().mockResolvedValue({
      id: 'sub_stripe_123',
      metadata: { tenantId: 'tenant-1' },
      items: {
        data: [{ id: 'si_123' }],
      },
    });
    mockStripeClient.subscriptions.update.mockReset().mockResolvedValue({
      id: 'sub_stripe_123',
      status: 'active',
      current_period_start: 1_700_000_000,
      current_period_end: 1_700_864_000,
      cancel_at_period_end: true,
      cancel_at: 1_700_864_000,
      canceled_at: null,
    });
    mockStripeClient.webhooks.constructEvent.mockReset();

    service = new BillingService({} as any);
  });

  it('creates checkout session and customer when missing stripeCustomerId', async () => {
    const result = await service.createCheckoutSession('tenant-1', 'PRO', 'https://app/success', 'https://app/cancel');

    expect(mockStripeClient.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { tenantId: 'tenant-1' } }),
    );
    expect(mockDb.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { stripeCustomerId: 'cus_123' } }),
    );
    expect(mockStripeClient.checkout.sessions.create).toHaveBeenCalled();
    expect(result).toEqual({ id: 'cs_123', url: 'https://checkout.stripe.com/cs_123', plan: 'PRO' });
  });

  it('reuses existing stripeCustomerId without creating a new customer', async () => {
    mockDb.subscription.findUnique.mockResolvedValueOnce({ id: 'sub-row', stripeCustomerId: 'cus_existing' });

    await service.createCheckoutSession('tenant-1', 'BASIC', 'https://app/success', 'https://app/cancel');

    expect(mockStripeClient.customers.create).not.toHaveBeenCalled();
    expect(mockStripeClient.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_existing' }),
    );
  });

  it('throws when webhook signature header is missing', async () => {
    await expect(service.handleStripeWebhook(undefined, Buffer.from('{}'))).rejects.toThrow(BadRequestException);
  });

  it('marks subscription past due on invoice.payment_failed', async () => {
    mockStripeClient.webhooks.constructEvent.mockReturnValueOnce({
      id: 'evt_1',
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_123',
          subscription: 'sub_stripe_123',
          amount_due: 9900,
          amount_paid: 0,
          currency: 'usd',
          status: 'open',
          status_transitions: { paid_at: null },
          due_date: 1_700_000_000,
        },
      },
    });

    const result = await service.handleStripeWebhook('sig_123', Buffer.from('{"id":"evt_1"}'));

    expect(mockDb.stripeWebhookEvent.create).toHaveBeenCalled();
    expect(mockDb.stripeWebhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED' }) }),
    );
    expect(mockDb.invoice.upsert).toHaveBeenCalled();
    expect(mockDb.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PAST_DUE' } }),
    );
    expect(result).toEqual({ received: true, eventType: 'invoice.payment_failed' });
  });

  it('updates tenant/subscription on checkout.session.completed', async () => {
    mockStripeClient.webhooks.constructEvent.mockReturnValueOnce({
      id: 'evt_2',
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata: { tenantId: 'tenant-1', plan: 'ENTERPRISE' },
          subscription: 'sub_stripe_999',
          customer: 'cus_999',
        },
      },
    });

    await service.handleStripeWebhook('sig_123', Buffer.from('{"id":"evt_2"}'));

    expect(mockDb.$transaction).toHaveBeenCalled();
  });

  it('returns duplicate true for already processed stripe event', async () => {
    mockStripeClient.webhooks.constructEvent.mockReturnValueOnce({
      id: 'evt_dup_1',
      type: 'invoice.payment_succeeded',
      data: { object: {} },
    });
    mockDb.stripeWebhookEvent.findUnique.mockResolvedValueOnce({ id: 'evt-row-1', status: 'PROCESSED' });

    const result = await service.handleStripeWebhook('sig_123', Buffer.from('{"id":"evt_dup_1"}'));

    expect(result).toEqual({ received: true, eventType: 'invoice.payment_succeeded', duplicate: true });
    expect(mockDb.invoice.upsert).not.toHaveBeenCalled();
  });

  it('cancels subscription at period end', async () => {
    mockDb.subscription.findUnique.mockResolvedValueOnce({
      id: 'sub-row',
      stripeSubscriptionId: 'sub_stripe_123',
    });

    const result = await service.cancelSubscription('tenant-1');

    expect(mockStripeClient.subscriptions.update).toHaveBeenCalledWith('sub_stripe_123', {
      cancel_at_period_end: true,
    });
    expect(mockDb.subscription.update).toHaveBeenCalled();
    expect(result.cancelAtPeriodEnd).toBe(true);
  });

  it('changes plan with selected proration behavior', async () => {
    mockDb.subscription.findUnique.mockResolvedValueOnce({
      id: 'sub-row',
      stripeSubscriptionId: 'sub_stripe_123',
    });

    const result = await service.changePlan('tenant-1', 'ENTERPRISE', 'always_invoice');

    expect(mockStripeClient.subscriptions.retrieve).toHaveBeenCalledWith('sub_stripe_123');
    expect(mockStripeClient.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        unit_amount: 29900,
        metadata: { tenantId: 'tenant-1', plan: 'ENTERPRISE' },
      }),
    );
    expect(mockStripeClient.subscriptions.update).toHaveBeenCalledWith(
      'sub_stripe_123',
      expect.objectContaining({
        proration_behavior: 'always_invoice',
        items: [{ id: 'si_123', price: 'price_new_123' }],
      }),
    );
    expect(mockDb.$transaction).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        plan: 'ENTERPRISE',
        status: 'ACTIVE',
        prorationBehavior: 'always_invoice',
      }),
    );
  });

  it('creates customer portal session for payment recovery', async () => {
    mockDb.subscription.findUnique.mockResolvedValueOnce({
      stripeCustomerId: 'cus_123',
    });

    const result = await service.createPortalSession('tenant-1', 'https://app/billing');

    expect(mockStripeClient.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_123',
      return_url: 'https://app/billing',
    });
    expect(result).toEqual({
      url: 'https://billing.stripe.com/session/test',
    });
  });

  it('resumes subscription by removing period-end cancellation', async () => {
    mockDb.subscription.findUnique.mockResolvedValueOnce({
      id: 'sub-row',
      stripeSubscriptionId: 'sub_stripe_123',
    });
    mockStripeClient.subscriptions.update.mockResolvedValueOnce({
      id: 'sub_stripe_123',
      status: 'active',
      current_period_start: 1_700_000_000,
      current_period_end: 1_700_864_000,
      cancel_at_period_end: false,
      cancel_at: null,
      canceled_at: null,
    });

    const result = await service.resumeSubscription('tenant-1');

    expect(mockStripeClient.subscriptions.update).toHaveBeenCalledWith('sub_stripe_123', {
      cancel_at_period_end: false,
    });
    expect(mockDb.subscription.update).toHaveBeenCalled();
    expect(result.cancelAtPeriodEnd).toBe(false);
  });
});
