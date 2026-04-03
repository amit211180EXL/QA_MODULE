// Unit tests for OutboundWebhooksService
// Uses mocked Prisma, encryption utils, and global fetch — no real network calls.

jest.mock('@qa/prisma-master', () => ({
  getMasterClient: jest.fn(() => mockDb),
}));

jest.mock('../common/utils/encryption.util', () => ({
  encrypt: jest.fn((v: string) => `ENC:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^ENC:/, '')),
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

let mockDb: {
  outboundWebhook: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  outboundWebhookDelivery: {
    create: jest.Mock;
    update: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    findFirst: jest.Mock;
  };
  $transaction: jest.Mock;
};

// ─────────────────────────────────────────────────────────────────────────────

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OutboundWebhooksService } from './outbound-webhooks.service';

const TENANT_ID = 'tenant-abc';
const HOOK_ID = 'hook-001';
const HOOK_URL = 'https://example.com/hook';

describe('OutboundWebhooksService', () => {
  let svc: OutboundWebhooksService;

  beforeEach(async () => {
    mockDb = {
      outboundWebhook: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      outboundWebhookDelivery: {
        create: jest.fn().mockResolvedValue({ id: 'delivery-1' }),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation((arr: Promise<unknown>[]) => Promise.all(arr)),
    };
    mockFetch.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [OutboundWebhooksService],
    }).compile();

    svc = module.get(OutboundWebhooksService);
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a webhook and returns the raw secret once', async () => {
      mockDb.outboundWebhook.create.mockResolvedValue({
        id: HOOK_ID,
        url: HOOK_URL,
        events: ['evaluation.completed'],
        status: 'ACTIVE',
        createdAt: new Date(),
      });

      const result = await svc.create(TENANT_ID, HOOK_URL, ['evaluation.completed']);

      expect(mockDb.outboundWebhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            url: HOOK_URL,
            events: ['evaluation.completed'],
          }),
        }),
      );
      expect(result.secret).toMatch(/^[a-f0-9]{64}$/); // 32 random bytes as hex
    });

    it('rejects invalid URLs', async () => {
      await expect(svc.create(TENANT_ID, 'not-a-url', ['evaluation.completed'])).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects non-http/https URLs', async () => {
      await expect(
        svc.create(TENANT_ID, 'ftp://example.com/hook', ['evaluation.completed']),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects empty events array', async () => {
      await expect(svc.create(TENANT_ID, HOOK_URL, [])).rejects.toThrow(BadRequestException);
    });

    it('rejects unknown event types', async () => {
      await expect(
        svc.create(TENANT_ID, HOOK_URL, ['evaluation.unknown' as never]),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── updateStatus ──────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    it('throws NotFoundException when hook not found', async () => {
      mockDb.outboundWebhook.findFirst.mockResolvedValue(null);
      await expect(svc.updateStatus(TENANT_ID, HOOK_ID, 'INACTIVE')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updates status to INACTIVE', async () => {
      mockDb.outboundWebhook.findFirst.mockResolvedValue({ id: HOOK_ID });
      mockDb.outboundWebhook.update.mockResolvedValue({ id: HOOK_ID, status: 'INACTIVE' });

      const result = await svc.updateStatus(TENANT_ID, HOOK_ID, 'INACTIVE');
      expect(mockDb.outboundWebhook.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'INACTIVE' } }),
      );
      expect(result).toMatchObject({ status: 'INACTIVE' });
    });
  });

  // ─── remove ────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('throws NotFoundException when hook not found', async () => {
      mockDb.outboundWebhook.findFirst.mockResolvedValue(null);
      await expect(svc.remove(TENANT_ID, HOOK_ID)).rejects.toThrow(NotFoundException);
    });

    it('deletes the hook when found', async () => {
      mockDb.outboundWebhook.findFirst.mockResolvedValue({ id: HOOK_ID });
      mockDb.outboundWebhook.delete.mockResolvedValue({});

      await svc.remove(TENANT_ID, HOOK_ID);
      expect(mockDb.outboundWebhook.delete).toHaveBeenCalledWith({ where: { id: HOOK_ID } });
    });
  });

  // ─── rotateSecret ──────────────────────────────────────────────────────────

  describe('rotateSecret', () => {
    it('returns a new raw secret (64-char hex)', async () => {
      mockDb.outboundWebhook.findFirst.mockResolvedValue({ id: HOOK_ID });
      mockDb.outboundWebhook.update.mockResolvedValue({});

      const { secret } = await svc.rotateSecret(TENANT_ID, HOOK_ID);
      expect(secret).toMatch(/^[a-f0-9]{64}$/);
    });

    it('throws NotFoundException when hook not found', async () => {
      mockDb.outboundWebhook.findFirst.mockResolvedValue(null);
      await expect(svc.rotateSecret(TENANT_ID, HOOK_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── deliver ───────────────────────────────────────────────────────────────

  describe('deliver', () => {
    const DATA = {
      evaluationId: 'eval-1',
      conversationId: 'conv-1',
      workflowState: 'LOCKED',
      finalScore: 87,
      passFail: true,
    };

    it('does nothing when no active hooks exist', async () => {
      mockDb.outboundWebhook.findMany.mockResolvedValue([]);
      svc.deliver(TENANT_ID, 'evaluation.completed', DATA);
      await new Promise((r) => setTimeout(r, 20));
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('skips hooks that do not subscribe to the event', async () => {
      mockDb.outboundWebhook.findMany.mockResolvedValue([
        { id: HOOK_ID, url: HOOK_URL, events: ['evaluation.escalated'], secretEnc: 'ENC:secret1' },
      ]);
      svc.deliver(TENANT_ID, 'evaluation.completed', DATA);
      await new Promise((r) => setTimeout(r, 20));
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('POSTs to matching active subscriptions', async () => {
      mockFetch.mockResolvedValue({ ok: true } as Response);
      mockDb.outboundWebhook.findMany.mockResolvedValue([
        {
          id: HOOK_ID,
          url: HOOK_URL,
          events: ['evaluation.completed'],
          secretEnc: 'ENC:mysecret',
        },
      ]);

      svc.deliver(TENANT_ID, 'evaluation.completed', DATA);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockFetch).toHaveBeenCalledWith(
        HOOK_URL,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-QA-Event': 'evaluation.completed',
          }),
        }),
      );
    });

    it('includes X-QA-Signature header with sha256= prefix', async () => {
      mockFetch.mockResolvedValue({ ok: true } as Response);
      mockDb.outboundWebhook.findMany.mockResolvedValue([
        { id: HOOK_ID, url: HOOK_URL, events: ['evaluation.completed'], secretEnc: 'ENC:s' },
      ]);

      svc.deliver(TENANT_ID, 'evaluation.completed', DATA);
      await new Promise((r) => setTimeout(r, 50));

      const call = mockFetch.mock.calls[0];
      const headers = call[1].headers as Record<string, string>;
      expect(headers['X-QA-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('does not throw when fetch rejects (fire-and-forget)', async () => {
      mockFetch.mockRejectedValue(new Error('network error'));
      mockDb.outboundWebhook.findMany.mockResolvedValue([
        { id: HOOK_ID, url: HOOK_URL, events: ['evaluation.completed'], secretEnc: 'ENC:s' },
      ]);

      expect(() => svc.deliver(TENANT_ID, 'evaluation.completed', DATA)).not.toThrow();
      await new Promise((r) => setTimeout(r, 50)); // let promise settle
    });
  });
});
