import { Injectable } from '@nestjs/common';
import { getMasterClient } from '@qa/prisma-master';
import { UpdateEscalationRulesDto, UpdateBlindReviewDto } from './dto/tenant-settings.dto';

@Injectable()
export class TenantSettingsService {
  private readonly db = getMasterClient();

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
}
