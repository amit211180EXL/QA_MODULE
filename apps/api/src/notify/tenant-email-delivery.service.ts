import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { getMasterClient } from '@qa/prisma-master';
import { getEnv } from '@qa/config';
import { decrypt } from '../common/utils/encryption.util';
import type { NotifyTemplate } from './notify.types';

type TenantSmtpRow = {
  smtpHost: string;
  smtpPort: number;
  encryption: 'NONE' | 'TLS' | 'SSL';
  smtpUser: string;
  smtpPassEnc: string;
};

function buildTransportOptions(row: TenantSmtpRow, plainPassword: string): SMTPTransport.Options {
  const secure = row.encryption === 'SSL';
  const auth =
    row.smtpUser || plainPassword
      ? { user: row.smtpUser || undefined, pass: plainPassword || undefined }
      : undefined;
  return {
    host: row.smtpHost,
    port: row.smtpPort,
    secure,
    auth,
    requireTLS: row.encryption === 'TLS',
    ignoreTLS: row.encryption === 'NONE',
  };
}

@Injectable()
export class TenantEmailDeliveryService {
  private readonly logger = new Logger(TenantEmailDeliveryService.name);
  private readonly db = getMasterClient();

  async isTemplateAllowed(tenantId: string, template: NotifyTemplate): Promise<boolean> {
    const row = await this.db.tenantEmailSettings.findUnique({
      where: { tenantId },
      select: { notificationsEnabled: true, forgotPasswordEnabled: true },
    });
    if (!row) return true;
    if (template === 'password_reset') return row.forgotPasswordEnabled;
    return row.notificationsEnabled;
  }

  /**
   * Tenant-specific SMTP when configured; otherwise platform env SMTP (may be null).
   */
  async resolveMailer(tenantId?: string): Promise<{ transporter: Transporter | null; from: string }> {
    const env = getEnv();
    if (tenantId) {
      const row = await this.db.tenantEmailSettings.findUnique({ where: { tenantId } });
      if (row?.smtpHost?.trim()) {
        const plain =
          row.smtpPassEnc && row.smtpPassEnc.length > 0 ? decrypt(row.smtpPassEnc) : '';
        const transporter = nodemailer.createTransport(buildTransportOptions(row, plain));
        const from =
          row.fromEmail?.trim().length > 0
            ? row.fromName?.trim()
              ? `${row.fromName.trim()} <${row.fromEmail.trim()}>`
              : row.fromEmail.trim()
            : env.EMAIL_FROM;
        return { transporter, from };
      }
    }

    if (env.SMTP_HOST) {
      const transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT ?? 587,
        secure: false,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      });
      return { transporter, from: env.EMAIL_FROM };
    }

    return { transporter: null, from: env.EMAIL_FROM };
  }

  async sendTestEmail(tenantId: string, to: string): Promise<void> {
    const { transporter, from } = await this.resolveMailer(tenantId);
    if (!transporter) {
      throw new Error(
        'No SMTP transport available. Save tenant SMTP settings or configure platform SMTP_HOST.',
      );
    }
    await transporter.sendMail({
      from,
      to,
      subject: 'QA Platform — test email',
      text: 'This is a test message from your workspace email configuration.',
      html: '<p>This is a <strong>test message</strong> from your workspace email configuration.</p>',
    });
    this.logger.log(`Test email sent to ${to} (tenant ${tenantId})`);
  }
}
