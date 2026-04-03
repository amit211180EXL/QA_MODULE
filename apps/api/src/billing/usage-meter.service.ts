import { Injectable } from '@nestjs/common';
import { getMasterClient } from '@qa/prisma-master';

@Injectable()
export class UsageMeterService {
  private readonly masterDb = getMasterClient();

  private currentPeriod() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }

  /** Increment conversations processed for the current month. */
  async recordConversation(tenantId: string, count = 1): Promise<void> {
    const { start, end } = this.currentPeriod();
    await this.masterDb.usageMetric.upsert({
      where: { tenantId_periodStart_periodEnd: { tenantId, periodStart: start, periodEnd: end } },
      create: {
        tenantId,
        periodStart: start,
        periodEnd: end,
        conversationsProcessed: count,
        aiTokensUsed: 0n,
        aiCostCents: 0,
        activeUsers: 0,
      },
      update: { conversationsProcessed: { increment: count } },
    });
  }

  /** Increment AI token + cost usage for the current month. */
  async recordAiUsage(tenantId: string, tokensUsed: number, costCents: number): Promise<void> {
    if (tokensUsed === 0 && costCents === 0) return;
    const { start, end } = this.currentPeriod();
    await this.masterDb.usageMetric.upsert({
      where: { tenantId_periodStart_periodEnd: { tenantId, periodStart: start, periodEnd: end } },
      create: {
        tenantId,
        periodStart: start,
        periodEnd: end,
        conversationsProcessed: 0,
        aiTokensUsed: BigInt(tokensUsed),
        aiCostCents: costCents,
        activeUsers: 0,
      },
      update: {
        aiTokensUsed: { increment: BigInt(tokensUsed) },
        aiCostCents: { increment: costCents },
      },
    });
  }

  /** Get conversations processed this month for the tenant. */
  async getMonthlyConversationCount(tenantId: string): Promise<number> {
    const { start, end } = this.currentPeriod();
    const metric = await this.masterDb.usageMetric.findUnique({
      where: { tenantId_periodStart_periodEnd: { tenantId, periodStart: start, periodEnd: end } },
      select: { conversationsProcessed: true },
    });
    return metric?.conversationsProcessed ?? 0;
  }
}
