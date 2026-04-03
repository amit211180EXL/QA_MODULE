// Unit tests for NotifyService + renderTemplate
// nodemailer and getEnv are mocked so no SMTP connections are made.

jest.mock('@qa/config', () => ({
  getEnv: jest.fn().mockReturnValue({
    EMAIL_FROM: 'noreply@qa.local',
    SMTP_HOST: undefined, // no transporter → dev-log mode
    SMTP_PORT: undefined,
    SMTP_USER: undefined,
    SMTP_PASS: undefined,
  }),
}));

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => mockTransporter),
}));

let mockTransporter: { sendMail: jest.Mock };

function createTenantMailMock(transporter: { sendMail: jest.Mock } | null = null) {
  return {
    isTemplateAllowed: jest.fn().mockResolvedValue(true),
    resolveMailer: jest.fn().mockResolvedValue({
      transporter,
      from: 'noreply@qa.local',
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

import { renderTemplate, NotifyService, NotifyTemplate } from './notify.service';

// ─── renderTemplate — pure unit tests ─────────────────────────────────────────

describe('renderTemplate', () => {
  // ─── tenant_ready ──────────────────────────────────────────────────────────

  describe('tenant_ready', () => {
    const data = { adminName: 'Alice', tenantName: 'Acme', loginUrl: 'https://app.qa.local/login' };

    it('sets a meaningful subject', () => {
      const { subject } = renderTemplate('tenant_ready', data);
      expect(subject).toContain('ready');
    });

    it('includes adminName in the body', () => {
      const { html, text } = renderTemplate('tenant_ready', data);
      expect(html).toContain('Alice');
      expect(text).toContain('Alice');
    });

    it('includes tenantName in the body', () => {
      const { html, text } = renderTemplate('tenant_ready', data);
      expect(html).toContain('Acme');
      expect(text).toContain('Acme');
    });

    it('includes the login URL', () => {
      const { html, text } = renderTemplate('tenant_ready', data);
      expect(html).toContain(data.loginUrl);
      expect(text).toContain(data.loginUrl);
    });

    it('handles missing data gracefully (no throw)', () => {
      expect(() => renderTemplate('tenant_ready', {})).not.toThrow();
    });
  });

  // ─── user_invited ──────────────────────────────────────────────────────────

  describe('user_invited', () => {
    const data = {
      name: 'Bob',
      role: 'QA',
      tenantName: 'Acme',
      inviteUrl: 'https://app.qa.local/accept-invite?token=abc123',
    };

    it('sets a subject that mentions the tenant', () => {
      const { subject } = renderTemplate('user_invited', data);
      expect(subject).toContain('Acme');
    });

    it('includes the invitee name', () => {
      const { html, text } = renderTemplate('user_invited', data);
      expect(html).toContain('Bob');
      expect(text).toContain('Bob');
    });

    it('includes the role', () => {
      const { html, text } = renderTemplate('user_invited', data);
      expect(html).toContain('QA');
      expect(text).toContain('QA');
    });

    it('includes the invite URL', () => {
      const { html, text } = renderTemplate('user_invited', data);
      expect(html).toContain(data.inviteUrl);
      expect(text).toContain(data.inviteUrl);
    });

    it('mentions the 72-hour expiry', () => {
      const { html, text } = renderTemplate('user_invited', data);
      expect(html + text).toMatch(/72/);
    });
  });

  // ─── password_reset ────────────────────────────────────────────────────────

  describe('password_reset', () => {
    const data = { resetUrl: 'https://app.qa.local/reset-password?token=xyz' };

    it('sets a meaningful subject', () => {
      const { subject } = renderTemplate('password_reset', data);
      expect(subject.toLowerCase()).toContain('password');
    });

    it('includes the reset URL', () => {
      const { html, text } = renderTemplate('password_reset', data);
      expect(html).toContain(data.resetUrl);
      expect(text).toContain(data.resetUrl);
    });

    it('mentions the 15-minute expiry', () => {
      const { html, text } = renderTemplate('password_reset', data);
      expect(html + text).toMatch(/15/);
    });
  });

  // ─── All templates return html + text + subject ────────────────────────────

  it.each<NotifyTemplate>(['tenant_ready', 'user_invited', 'password_reset'])(
    '%s returns non-empty subject, html, and text',
    (template) => {
      const { subject, html, text } = renderTemplate(template, {});
      expect(subject.length).toBeGreaterThan(0);
      expect(html.length).toBeGreaterThan(0);
      expect(text.length).toBeGreaterThan(0);
    },
  );
});

// ─── NotifyService.send ────────────────────────────────────────────────────────

describe('NotifyService', () => {
  let svc: NotifyService;

  describe('without SMTP (dev-log mode)', () => {
    beforeEach(() => {
      // getEnv returns no SMTP_HOST → transporter = null
      svc = new NotifyService(createTenantMailMock() as any);
    });

    it('does not throw when send is called', async () => {
      await expect(
        svc.send({ to: 'test@example.com', template: 'tenant_ready', data: {} }),
      ).resolves.not.toThrow();
    });

    it('does not attempt to call sendMail (no transporter)', async () => {
      await svc.send({ to: 'test@example.com', template: 'user_invited', data: {} });
      // mockTransporter.sendMail should not exist / not be called
      expect(mockTransporter?.sendMail ?? jest.fn()).not.toHaveBeenCalled();
    });
  });

  describe('with SMTP configured', () => {
    beforeEach(() => {
      mockTransporter = { sendMail: jest.fn().mockResolvedValue({ messageId: 'msg-1' }) };

      const { getEnv } = require('@qa/config');
      (getEnv as jest.Mock).mockReturnValue({
        EMAIL_FROM: 'noreply@qa.local',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: 587,
        SMTP_USER: undefined,
        SMTP_PASS: undefined,
      });

      svc = new NotifyService(createTenantMailMock(mockTransporter) as any);
    });

    afterEach(() => {
      const { getEnv } = require('@qa/config');
      (getEnv as jest.Mock).mockReturnValue({
        EMAIL_FROM: 'noreply@qa.local',
        SMTP_HOST: undefined,
        SMTP_PORT: undefined,
        SMTP_USER: undefined,
        SMTP_PASS: undefined,
      });
    });

    it('calls sendMail with the correct recipient', async () => {
      await svc.send({
        to: 'admin@acme.com',
        template: 'tenant_ready',
        data: { adminName: 'Alice', tenantName: 'Acme', loginUrl: 'https://x.com' },
      });

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'admin@acme.com' }),
      );
    });

    it('uses EMAIL_FROM as the sender', async () => {
      await svc.send({ to: 'x@acme.com', template: 'password_reset', data: { resetUrl: 'u' } });

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'noreply@qa.local' }),
      );
    });

    it('sends html and text parts', async () => {
      await svc.send({ to: 'x@acme.com', template: 'password_reset', data: { resetUrl: 'u' } });

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.any(String),
          text: expect.any(String),
        }),
      );
    });
  });
});
