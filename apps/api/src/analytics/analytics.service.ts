import { Injectable, Inject } from '@nestjs/common';
import { getMasterClient } from '@qa/prisma-master';
import { TenantConnectionPool } from '../tenant/tenant-connection-pool.service';

@Injectable()
export class AnalyticsService {
  private readonly masterDb = getMasterClient();

  constructor(
    @Inject(TenantConnectionPool)
    private readonly pool: TenantConnectionPool,
  ) {}

  private async getDb(tenantId: string) {
    return this.pool.getClient(tenantId);
  }

  async getOverview(tenantId: string, from: Date, to: Date) {
    const db = await this.getDb(tenantId);

    const [
      totalConversations,
      completedEvaluations,
      pendingQA,
      pendingVerifier,
      scoreAgg,
    ] = await Promise.all([
      db.conversation.count({ where: { receivedAt: { gte: from, lte: to } } }),
      db.evaluation.count({ where: { workflowState: 'LOCKED', updatedAt: { gte: from, lte: to } } }),
      db.workflowQueue.count({ where: { queueType: 'QA_QUEUE' } }),
      db.workflowQueue.count({ where: { queueType: 'VERIFIER_QUEUE' } }),
      db.evaluation.aggregate({
        where: { workflowState: 'LOCKED', lockedAt: { gte: from, lte: to } },
        _avg: { finalScore: true, aiScore: true, qaScore: true },
        _count: { passFail: true },
      }),
    ]);

    // Pass rate
    const passCount = await db.evaluation.count({
      where: { workflowState: 'LOCKED', passFail: true, lockedAt: { gte: from, lte: to } },
    });

    const passRate = completedEvaluations > 0 ? (passCount / completedEvaluations) * 100 : 0;

    // Avg deviation AI vs QA
    const deviationAgg = await db.deviationRecord.aggregate({
      where: { createdAt: { gte: from, lte: to } },
      _avg: { deviation: true },
    });

    return {
      totalConversations,
      completedEvaluations,
      pendingQA,
      pendingVerifier,
      avgFinalScore: scoreAgg._avg.finalScore ?? null,
      passRate: Math.round(passRate * 10) / 10,
      avgAiQaDeviation: deviationAgg._avg.deviation ?? null,
    };
  }

  async getAgentPerformance(tenantId: string, from: Date, to: Date) {
    const db = await this.getDb(tenantId);

    const results = await db.$queryRaw<
      Array<{
        agentId: string | null;
        agentName: string | null;
        count: bigint;
        avgScore: number | null;
        passCount: bigint;
      }>
    >`
      SELECT
        c."agentId",
        c."agentName",
        COUNT(e.id) as "count",
        AVG(e."finalScore") as "avgScore",
        SUM(CASE WHEN e."passFail" = true THEN 1 ELSE 0 END) as "passCount"
      FROM conversations c
      JOIN evaluations e ON e."conversationId" = c.id
      WHERE e."workflowState" = 'LOCKED'
        AND e."lockedAt" >= ${from}
        AND e."lockedAt" <= ${to}
      GROUP BY c."agentId", c."agentName"
      ORDER BY "avgScore" DESC NULLS LAST
      LIMIT 50
    `;

    return results.map((r) => ({
      agentId: r.agentId,
      agentName: r.agentName,
      totalEvaluations: Number(r.count),
      avgScore: r.avgScore ? Math.round(r.avgScore * 10) / 10 : null,
      passRate:
        Number(r.count) > 0 ? Math.round((Number(r.passCount) / Number(r.count)) * 1000) / 10 : 0,
    }));
  }

  async getDeviationTrends(tenantId: string, from: Date, to: Date) {
    const db = await this.getDb(tenantId);

    const records = await db.deviationRecord.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { type: true, deviation: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    // Group by day + type
    const byDay: Record<string, { date: string; AI_VS_QA: number[]; QA_VS_VERIFIER: number[] }> = {};
    for (const r of records) {
      const day = r.createdAt.toISOString().slice(0, 10);
      if (!byDay[day]) byDay[day] = { date: day, AI_VS_QA: [], QA_VS_VERIFIER: [] };
      byDay[day][r.type as 'AI_VS_QA' | 'QA_VS_VERIFIER'].push(r.deviation);
    }

    return Object.values(byDay).map((d) => ({
      date: d.date,
      avgAiQaDeviation:
        d.AI_VS_QA.length > 0 ? d.AI_VS_QA.reduce((s, v) => s + v, 0) / d.AI_VS_QA.length : null,
      avgQaVerifierDeviation:
        d.QA_VS_VERIFIER.length > 0
          ? d.QA_VS_VERIFIER.reduce((s, v) => s + v, 0) / d.QA_VS_VERIFIER.length
          : null,
    }));
  }
}
