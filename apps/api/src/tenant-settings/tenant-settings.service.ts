import { Injectable, Inject } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { getMasterClient } from '@qa/prisma-master';
import { TenantConnectionPool } from '../tenant/tenant-connection-pool.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { TenantEmailDeliveryService } from '../notify/tenant-email-delivery.service';
import { encrypt } from '../common/utils/encryption.util';
import {
  UpdateBlindReviewDto,
  UpdateEscalationRulesDto,
  UpdateTenantEmailSettingsDto,
} from './dto/tenant-settings.dto';

const DEFAULT_EMAIL_SETTINGS = {
  smtpHost: '',
  smtpPort: 587,
  encryption: 'TLS' as const,
  smtpUsername: '',
  fromEmail: '',
  fromName: '',
  notificationsEnabled: true,
  forgotPasswordEnabled: true,
};

@Injectable()
export class TenantSettingsService {
  private readonly db = getMasterClient();

  constructor(
    @Inject(TenantConnectionPool)
    private readonly pool: TenantConnectionPool,
    private readonly webhooksService: WebhooksService,
    private readonly tenantEmailDeliveryService: TenantEmailDeliveryService,
  ) {}

  private async getTenantDb(tenantId: string) {
    return this.pool.getClient(tenantId);
  }

  async getSettings(tenantId: string) {
    const [tenant, escalation, blindReview] = await Promise.all([
      this.db.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { id: true, name: true, slug: true, plan: true, status: true },
      }),
      this.db.escalationRule.findFirst({ where: { tenantId } }),
      this.db.blindReviewSettings.findUnique({ where: { tenantId } }),
    ]);

    return { tenant, escalation, blindReview };
  }

  async getEmailSettings(tenantId: string) {
    const row = await this.db.tenantEmailSettings.findUnique({ where: { tenantId } });

    return {
      ...DEFAULT_EMAIL_SETTINGS,
      ...(row
        ? {
            smtpHost: row.smtpHost,
            smtpPort: row.smtpPort,
            encryption: row.encryption,
            smtpUsername: row.smtpUser,
            fromEmail: row.fromEmail,
            fromName: row.fromName,
            notificationsEnabled: row.notificationsEnabled,
            forgotPasswordEnabled: row.forgotPasswordEnabled,
            smtpPasswordConfigured: Boolean(row.smtpPassEnc),
          }
        : { smtpPasswordConfigured: false }),
    };
  }

  async upsertEscalationRules(tenantId: string, dto: UpdateEscalationRulesDto) {
    return this.db.escalationRule.upsert({
      where: {
        id:
          (await this.db.escalationRule.findFirst({ where: { tenantId }, select: { id: true } }))
            ?.id ?? '',
      },
      create: {
        tenantId,
        qaDeviationThreshold: dto.qaDeviationThreshold ?? 15,
        verifierDeviationThreshold: dto.verifierDeviationThreshold ?? 10,
        staleQueueHours: dto.staleQueueHours ?? 24,
      },
      update: {
        ...(dto.qaDeviationThreshold !== undefined && {
          qaDeviationThreshold: dto.qaDeviationThreshold,
        }),
        ...(dto.verifierDeviationThreshold !== undefined && {
          verifierDeviationThreshold: dto.verifierDeviationThreshold,
        }),
        ...(dto.staleQueueHours !== undefined && { staleQueueHours: dto.staleQueueHours }),
      },
    });
  }

  async upsertBlindReview(tenantId: string, dto: UpdateBlindReviewDto) {
    return this.db.blindReviewSettings.upsert({
      where: { tenantId },
      create: {
        tenantId,
        hideAgentFromQA: dto.hideAgentFromQA ?? false,
        hideQAFromVerifier: dto.hideQAFromVerifier ?? false,
      },
      update: {
        ...(dto.hideAgentFromQA !== undefined && { hideAgentFromQA: dto.hideAgentFromQA }),
        ...(dto.hideQAFromVerifier !== undefined && { hideQAFromVerifier: dto.hideQAFromVerifier }),
      },
    });
  }

  async upsertEmailSettings(tenantId: string, dto: UpdateTenantEmailSettingsDto) {
    const smtpHost = dto.smtpHost?.trim();
    const smtpUsername = dto.smtpUsername?.trim();
    const fromEmail = dto.fromEmail?.trim();
    const fromName = dto.fromName?.trim();

    await this.db.tenantEmailSettings.upsert({
      where: { tenantId },
      create: {
        tenantId,
        smtpHost: smtpHost ?? DEFAULT_EMAIL_SETTINGS.smtpHost,
        smtpPort: dto.smtpPort ?? DEFAULT_EMAIL_SETTINGS.smtpPort,
        encryption: dto.encryption ?? DEFAULT_EMAIL_SETTINGS.encryption,
        smtpUser: smtpUsername ?? DEFAULT_EMAIL_SETTINGS.smtpUsername,
        smtpPassEnc:
          dto.smtpPassword === undefined
            ? ''
            : dto.smtpPassword.length > 0
              ? encrypt(dto.smtpPassword)
              : '',
        fromEmail: fromEmail ?? DEFAULT_EMAIL_SETTINGS.fromEmail,
        fromName: fromName ?? DEFAULT_EMAIL_SETTINGS.fromName,
        notificationsEnabled: dto.notificationsEnabled ?? DEFAULT_EMAIL_SETTINGS.notificationsEnabled,
        forgotPasswordEnabled:
          dto.forgotPasswordEnabled ?? DEFAULT_EMAIL_SETTINGS.forgotPasswordEnabled,
      },
      update: {
        ...(dto.smtpHost !== undefined && { smtpHost: smtpHost ?? '' }),
        ...(dto.smtpPort !== undefined && { smtpPort: dto.smtpPort }),
        ...(dto.encryption !== undefined && { encryption: dto.encryption }),
        ...(dto.smtpUsername !== undefined && { smtpUser: smtpUsername ?? '' }),
        ...(dto.smtpPassword !== undefined && {
          smtpPassEnc: dto.smtpPassword.length > 0 ? encrypt(dto.smtpPassword) : '',
        }),
        ...(dto.fromEmail !== undefined && { fromEmail: fromEmail ?? '' }),
        ...(dto.fromName !== undefined && { fromName: fromName ?? '' }),
        ...(dto.notificationsEnabled !== undefined && {
          notificationsEnabled: dto.notificationsEnabled,
        }),
        ...(dto.forgotPasswordEnabled !== undefined && {
          forgotPasswordEnabled: dto.forgotPasswordEnabled,
        }),
      },
    });

    return this.getEmailSettings(tenantId);
  }

  async sendTestEmail(tenantId: string, to: string) {
    await this.tenantEmailDeliveryService.sendTestEmail(tenantId, to);
    return { success: true };
  }

  async getOnboardingStatus(tenantId: string) {
    const tenantDb = await this.getTenantDb(tenantId);

    const [llmConfig, nonAdminUsers, publishedForm, conversationCount] = await Promise.all([
      this.db.llmConfig.findUnique({ where: { tenantId }, select: { id: true } }),
      this.db.user.count({ where: { tenantId, role: { not: 'ADMIN' } } }),
      tenantDb.formDefinition.findFirst({
        where: { status: 'PUBLISHED' },
        select: { id: true },
      }),
      tenantDb.conversation.count(),
    ]);

    const hasLlmConfig = llmConfig !== null;
    const hasNonAdminUsers = nonAdminUsers > 0;
    const hasPublishedForm = publishedForm !== null;
    const hasConversations = conversationCount > 0;
    const isComplete = hasLlmConfig && hasNonAdminUsers && hasPublishedForm && hasConversations;

    return { hasLlmConfig, hasNonAdminUsers, hasPublishedForm, hasConversations, isComplete };
  }

  /** Generate a new webhook API key. Returns plaintext only once — not stored in DB. */
  async rotateApiKey(tenantId: string): Promise<{ apiKey: string }> {
    const rawKey = `qa_${randomBytes(32).toString('base64url')}`;
    await this.webhooksService.registerApiKey(tenantId, rawKey);
    return { apiKey: rawKey };
  }
}
