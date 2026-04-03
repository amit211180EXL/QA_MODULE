import { Injectable, Logger } from '@nestjs/common';
import { TenantEmailDeliveryService } from './tenant-email-delivery.service';
import type { NotifyTemplate } from './notify.types';

export type { NotifyTemplate };

export interface NotifyPayload {
  to: string;
  template: NotifyTemplate;
  data: Record<string, string>;
}

export function renderTemplate(
  template: NotifyTemplate,
  data: Record<string, string>,
): { subject: string; html: string; text: string } {
  switch (template) {
    case 'tenant_ready':
      return {
        subject: 'Your QA Platform workspace is ready',
        html: `<p>Hi ${data.adminName ?? 'there'},</p><p>Your workspace <strong>${data.tenantName ?? ''}</strong> is ready. <a href="${data.loginUrl ?? '#'}">Log in now</a>.</p>`,
        text: `Hi ${data.adminName ?? 'there'}, your workspace ${data.tenantName ?? ''} is ready. Log in: ${data.loginUrl ?? ''}`,
      };

    case 'user_invited':
      return {
        subject: `You've been invited to ${data.tenantName ?? 'the QA Platform'}`,
        html: `<p>Hi ${data.name ?? 'there'},</p><p>You have been invited as <strong>${data.role ?? 'a user'}</strong>. <a href="${data.inviteUrl ?? '#'}">Accept your invitation</a>. This link expires in 72 hours.</p>`,
        text: `Hi ${data.name ?? 'there'}, you have been invited as ${data.role ?? 'a user'} to ${data.tenantName ?? ''}. Accept: ${data.inviteUrl ?? ''} (expires in 72 hours)`,
      };

    case 'password_reset':
      return {
        subject: 'Reset your QA Platform password',
        html: `<p>Hi,</p><p><a href="${data.resetUrl ?? '#'}">Click here to reset your password</a>. This link expires in 15 minutes.</p>`,
        text: `Reset your password: ${data.resetUrl ?? ''} (expires in 15 minutes)`,
      };

    default: {
      const _exhaustive: never = template;
      throw new Error(`Unknown email template: ${_exhaustive}`);
    }
  }
}

@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(private readonly tenantMail: TenantEmailDeliveryService) {}

  async send(payload: NotifyPayload, options?: { tenantId?: string }): Promise<void> {
    const tenantId = options?.tenantId;
    if (tenantId) {
      const allowed = await this.tenantMail.isTemplateAllowed(tenantId, payload.template);
      if (!allowed) {
        this.logger.log(`Skipping ${payload.template} for tenant ${tenantId} (disabled in email settings)`);
        return;
      }
    }

    const { subject, html, text } = renderTemplate(payload.template, payload.data);
    const { transporter, from } = await this.tenantMail.resolveMailer(tenantId);

    if (transporter) {
      await transporter.sendMail({
        from,
        to: payload.to,
        subject,
        html,
        text,
      });
      this.logger.log(`Email sent [${payload.template}] → ${payload.to}`);
    } else {
      this.logger.log(
        `[DEV EMAIL] to=${payload.to} template=${payload.template} subject="${subject}"\n${text}`,
      );
    }
  }
}
