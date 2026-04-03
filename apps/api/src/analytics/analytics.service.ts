import { Injectable, Inject } from '@nestjs/common';
import { getMasterClient } from '@qa/prisma-master';
import { TenantConnectionPool } from '../tenant/tenant-connection-pool.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import Redis from 'ioredis';

@Injectable()
export class AnalyticsService {
  private readonly masterDb = getMasterClient();
  private readonly cacheTtlSeconds = 60;

  constructor(
    @Inject(TenantConnectionPool)
    private readonly pool: TenantConnectionPool,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private async getDb(tenantId: string) {
    return this.pool.getReadClient(tenantId);
  }

  private buildCacheKey(tenantId: string, metric: string, from: Date, to: Date): string {
    return `analytics:${tenantId}:${metric}:${from.toISOString()}:${to.toISOString()}`;
  }

  private async getOrSetCache<T>(
    key: string,
    producer: () => Promise<T>,
    ttlSeconds = this.cacheTtlSeconds,
  ): Promise<T> {
    try {
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached) as T;
    } catch {
      // Fall through to compute path on cache read errors.
    }

    const value = await producer();

    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      // Cache write failures should never fail analytics requests.
    }

    return value;
  }

  async getOverview(tenantId: string, from: Date, to: Date) {
    const key = this.buildCacheKey(tenantId, 'overview', from, to);
    return this.getOrSetCache(key, async () => {
      const db = await this.getDb(tenantId);

      const [totalConversations, completedEvaluations, pendingQA, pendingVerifier, scoreAgg] =
        await Promise.all([
          db.conversation.count({ where: { receivedAt: { gte: from, lte: to } } }),
          db.evaluation.count({
            where: { workflowState: 'LOCKED', updatedAt: { gte: from, lte: to } },
          }),
          db.workflowQueue.count({ where: { queueType: 'QA_QUEUE' } }),
          db.workflowQueue.count({ where: { queueType: 'VERIFIER_QUEUE' } }),
          db.evaluation.aggregate({
            where: { workflowState: 'LOCKED', lockedAt: { gte: from, lte: to } },
            _avg: { finalScore: true, aiScore: true, qaScore: true },
            _count: { passFail: true },
          }),
        ]);

      const [passCount, deviationAgg] = await Promise.all([
        // Pass rate
        db.evaluation.count({
          where: { workflowState: 'LOCKED', passFail: true, lockedAt: { gte: from, lte: to } },
        }),
        // Avg deviation AI vs QA
        db.deviationRecord.aggregate({
          where: { createdAt: { gte: from, lte: to } },
          _avg: { deviation: true },
        }),
      ]);

      const passRate = completedEvaluations > 0 ? (passCount / completedEvaluations) * 100 : 0;

      return {
        totalConversations,
        completedEvaluations,
        pendingQA,
        pendingVerifier,
        avgFinalScore: scoreAgg._avg.finalScore ?? null,
        passRate: Math.round(passRate * 10) / 10,
        avgAiQaDeviation: deviationAgg._avg.deviation ?? null,
      };
    });
  }

  async getAgentPerformance(tenantId: string, from: Date, to: Date) {
    const key = this.buildCacheKey(tenantId, 'agent_performance', from, to);
    return this.getOrSetCache(key, async () => {
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
          Number(r.count) > 0
            ? Math.round((Number(r.passCount) / Number(r.count)) * 1000) / 10
            : 0,
      }));
    });
  }

  async getDeviationTrends(tenantId: string, from: Date, to: Date) {
    const key = this.buildCacheKey(tenantId, 'deviation_trends', from, to);
    return this.getOrSetCache(key, async () => {
      const db = await this.getDb(tenantId);

      const records = await db.deviationRecord.findMany({
        where: { createdAt: { gte: from, lte: to } },
        select: { type: true, deviation: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });

      // Group by day + type
      const byDay: Record<
        string,
        { date: string; AI_VS_QA: number[]; QA_VS_VERIFIER: number[] }
      > = {};
      for (const r of records) {
        const day = r.createdAt.toISOString().slice(0, 10);
        if (!byDay[day]) byDay[day] = { date: day, AI_VS_QA: [], QA_VS_VERIFIER: [] };
        byDay[day][r.type as 'AI_VS_QA' | 'QA_VS_VERIFIER'].push(r.deviation);
      }

      return Object.values(byDay).map((d) => ({
        date: d.date,
        avgAiQaDeviation:
          d.AI_VS_QA.length > 0
            ? d.AI_VS_QA.reduce((s, v) => s + v, 0) / d.AI_VS_QA.length
            : null,
        avgQaVerifierDeviation:
          d.QA_VS_VERIFIER.length > 0
            ? d.QA_VS_VERIFIER.reduce((s, v) => s + v, 0) / d.QA_VS_VERIFIER.length
            : null,
      }));
    });
  }

  // Returns the most-overridden questions (QA changed AI answer), sorted by override count desc.
  async getQuestionDeviations(tenantId: string, from: Date, to: Date) {
    const key = this.buildCacheKey(tenantId, 'question_deviations', from, to);
    return this.getOrSetCache(key, async () => {
      const db = await this.getDb(tenantId);

    // Per-question deviation records have questionKey set and deviation = 1 (override event)
      const records = await db.deviationRecord.findMany({
        where: {
          type: 'AI_VS_QA',
          questionKey: { not: null },
          createdAt: { gte: from, lte: to },
        },
        select: { questionKey: true, sectionId: true, createdAt: true },
      });

    // Total QA submissions in period (denominator for override rate)
      const totalEvals = await db.evaluation.count({
        where: {
          workflowState: {
            in: ['QA_COMPLETED', 'VERIFIER_PENDING', 'VERIFIER_IN_PROGRESS', 'LOCKED', 'ESCALATED'],
          },
          qaCompletedAt: { gte: from, lte: to },
        },
      });

    // Group by questionKey
      const counts: Record<
        string,
        { questionKey: string; sectionId: string | null; count: number }
      > = {};
      for (const r of records) {
        const k = r.questionKey!;
        if (!counts[k]) counts[k] = { questionKey: k, sectionId: r.sectionId, count: 0 };
        counts[k].count++;
      }

      return Object.values(counts)
        .sort((a, b) => b.count - a.count)
        .slice(0, 20)
        .map((r) => ({
          questionKey: r.questionKey,
          sectionId: r.sectionId,
          overrideCount: r.count,
          overrideRate: totalEvals > 0 ? Math.round((r.count / totalEvals) * 1000) / 10 : 0,
        }));
    });
  }

  // Returns count of escalated evaluations in period.
  async getEscalationStats(tenantId: string, from: Date, to: Date) {
    const key = this.buildCacheKey(tenantId, 'escalation_stats', from, to);
    return this.getOrSetCache(key, async () => {
      const db = await this.getDb(tenantId);
      const [escalated, pending] = await Promise.all([
        db.evaluation.count({
          where: { isEscalated: true, qaCompletedAt: { gte: from, lte: to } },
        }),
        db.workflowQueue.count({ where: { queueType: 'ESCALATION_QUEUE' } }),
      ]);
      return { escalated, pendingEscalation: pending };
    });
  }

  // Per-question verifier overrides (QA_VS_VERIFIER records with questionKey set).
  async getVerifierOverrides(tenantId: string, from: Date, to: Date) {
    const key = this.buildCacheKey(tenantId, 'verifier_overrides', from, to);
    return this.getOrSetCache(key, async () => {
      const db = await this.getDb(tenantId);

      const records = await db.deviationRecord.findMany({
        where: {
          type: 'QA_VS_VERIFIER',
          questionKey: { not: null },
          createdAt: { gte: from, lte: to },
        },
        select: { questionKey: true, sectionId: true },
      });

      const totalVerified = await db.evaluation.count({
        where: {
          workflowState: { in: ['LOCKED'] },
          verifierCompletedAt: { gte: from, lte: to },
        },
      });

      const counts: Record<
        string,
        { questionKey: string; sectionId: string | null; count: number }
      > = {};
      for (const r of records) {
        const k = r.questionKey!;
        if (!counts[k]) counts[k] = { questionKey: k, sectionId: r.sectionId, count: 0 };
        counts[k].count++;
      }

      return Object.values(counts)
        .sort((a, b) => b.count - a.count)
        .slice(0, 20)
        .map((r) => ({
          questionKey: r.questionKey,
          sectionId: r.sectionId,
          overrideCount: r.count,
          overrideRate: totalVerified > 0 ? Math.round((r.count / totalVerified) * 1000) / 10 : 0,
        }));
    });
  }

  // Groups verifier rejection reasons from audit log.
  async getRejectionReasons(tenantId: string, from: Date, to: Date) {
    const key = this.buildCacheKey(tenantId, 'rejection_reasons', from, to);
    return this.getOrSetCache(key, async () => {
      const db = await this.getDb(tenantId);

      const logs = await db.auditLog.findMany({
        where: {
          action: 'verifier_reject',
          createdAt: { gte: from, lte: to },
        },
        select: { metadata: true, createdAt: true },
      });

      const counts: Record<string, number> = {};
      for (const log of logs) {
        const meta = log.metadata as Record<string, unknown> | null;
        const reason = (meta?.reason as string | undefined) ?? 'Unspecified';
        counts[reason] = (counts[reason] ?? 0) + 1;
      }

      const total = logs.length;
      return Object.entries(counts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 15)
        .map(([reason, count]) => ({
          reason,
          count,
          rate: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
        }));
    });
  }

  // Daily avg score + pass rate, plus breakdown by channel.
  async getScoreTrends(tenantId: string, from: Date, to: Date) {
    const key = this.buildCacheKey(tenantId, 'score_trends', from, to);
    return this.getOrSetCache(key, async () => {
      const db = await this.getDb(tenantId);

      const [byDayRaw, byChannelRaw] = await Promise.all([
        db.$queryRaw<
          Array<{ date: string; avgScore: number | null; count: bigint; passCount: bigint }>
        >`
        SELECT
          DATE(e."lockedAt") AS date,
          AVG(e."finalScore") AS "avgScore",
          COUNT(*) AS count,
          SUM(CASE WHEN e."passFail" = true THEN 1 ELSE 0 END) AS "passCount"
        FROM evaluations e
        WHERE e."workflowState" = 'LOCKED'
          AND e."lockedAt" >= ${from}
          AND e."lockedAt" <= ${to}
        GROUP BY DATE(e."lockedAt")
        ORDER BY date ASC
      `,
        db.$queryRaw<
          Array<{
            channel: string;
            avgScore: number | null;
            count: bigint;
            passCount: bigint;
          }>
        >`
        SELECT
          c."channel",
          AVG(e."finalScore") AS "avgScore",
          COUNT(*) AS count,
          SUM(CASE WHEN e."passFail" = true THEN 1 ELSE 0 END) AS "passCount"
        FROM evaluations e
        JOIN conversations c ON c.id = e."conversationId"
        WHERE e."workflowState" = 'LOCKED'
          AND e."lockedAt" >= ${from}
          AND e."lockedAt" <= ${to}
        GROUP BY c."channel"
        ORDER BY count DESC
      `,
      ]);

      const byDay = byDayRaw.map((r) => ({
        date: typeof r.date === 'string' ? r.date : (r.date as Date).toISOString().slice(0, 10),
        avgScore: r.avgScore ? Math.round(r.avgScore * 10) / 10 : null,
        count: Number(r.count),
        passRate:
          Number(r.count) > 0
            ? Math.round((Number(r.passCount) / Number(r.count)) * 1000) / 10
            : 0,
      }));

      const byChannel = byChannelRaw.map((r) => ({
        channel: r.channel,
        avgScore: r.avgScore ? Math.round(r.avgScore * 10) / 10 : null,
        count: Number(r.count),
        passRate:
          Number(r.count) > 0
            ? Math.round((Number(r.passCount) / Number(r.count)) * 1000) / 10
            : 0,
      }));

      return { byDay, byChannel };
    });
  }

  // Monthly AI usage/cost from master DB UsageMetric table.
  async getAiUsageTrends(tenantId: string, from: Date, to: Date) {
    const key = this.buildCacheKey(tenantId, 'ai_usage_trends', from, to);
    return this.getOrSetCache(key, async () => {
      const metrics = await this.masterDb.usageMetric.findMany({
        where: {
          tenantId,
          periodStart: { gte: from },
          periodEnd: { lte: to },
        },
        orderBy: { periodStart: 'asc' },
        select: {
          periodStart: true,
          periodEnd: true,
          conversationsProcessed: true,
          aiTokensUsed: true,
          aiCostCents: true,
          activeUsers: true,
        },
      });

      return metrics.map((m) => ({
        period: m.periodStart.toISOString().slice(0, 7), // YYYY-MM
        periodStart: m.periodStart.toISOString(),
        periodEnd: m.periodEnd.toISOString(),
        conversationsProcessed: m.conversationsProcessed,
        aiTokensUsed: Number(m.aiTokensUsed),
        aiCostCents: m.aiCostCents,
        aiCostDollars: m.aiCostCents / 100,
        activeUsers: m.activeUsers,
      }));
    });
  }

  // ── NEW REPORT METHODS ────────────────────────────────────────────────────

  // Per-QA-reviewer: evaluations reviewed, avg QA score, avg turnaround (start→complete).
  async getQaReviewerPerformance(tenantId: string, from: Date, to: Date) {
    const key = this.buildCacheKey(tenantId, 'qa_reviewer_performance', from, to);
    return this.getOrSetCache(key, async () => {
      const db = await this.getDb(tenantId);
      const rows = await db.$queryRaw<
        Array<{
          qaUserId: string | null;
          count: bigint;
          avgQaScore: number | null;
          avgTurnaroundMs: number | null;
        }>
      >`
        SELECT
          e."qaUserId",
          COUNT(*) AS count,
          AVG(e."qaScore") AS "avgQaScore",
          AVG(EXTRACT(EPOCH FROM (e."qaCompletedAt" - e."qaStartedAt")) * 1000) AS "avgTurnaroundMs"
        FROM evaluations e
        WHERE e."qaUserId" IS NOT NULL
          AND e."qaCompletedAt" >= ${from}
          AND e."qaCompletedAt" <= ${to}
        GROUP BY e."qaUserId"
        ORDER BY count DESC
      `;
      return rows.map((r) => ({
        qaUserId: r.qaUserId,
        totalReviewed: Number(r.count),
        avgQaScore: r.avgQaScore ? Math.round(r.avgQaScore * 10) / 10 : null,
        avgTurnaroundMinutes: r.avgTurnaroundMs
          ? Math.round(Number(r.avgTurnaroundMs) / 60000)
          : null,
      }));
    });
  }

  // Per-verifier: verified count, rejected count, avg verifier score.
  async getVerifierReport(tenantId: string, from: Date, to: Date) {
    const key = this.buildCacheKey(tenantId, 'verifier_report', from, to);
    return this.getOrSetCache(key, async () => {
      const db = await this.getDb(tenantId);
      const rows = await db.$queryRaw<
        Array<{
          verifierUserId: string | null;
          verified: bigint;
          rejected: bigint;
          avgVerifierScore: number | null;
        }>
      >`
        SELECT
          e."verifierUserId",
          COUNT(*) AS verified,
          SUM(CASE WHEN e."verifierRejectedAt" IS NOT NULL THEN 1 ELSE 0 END) AS rejected,
          AVG(e."verifierScore") AS "avgVerifierScore"
        FROM evaluations e
        WHERE e."verifierUserId" IS NOT NULL
          AND e."verifierCompletedAt" >= ${from}
          AND e."verifierCompletedAt" <= ${to}
        GROUP BY e."verifierUserId"
        ORDER BY verified DESC
      `;
      return rows.map((r) => ({
        verifierUserId: r.verifierUserId,
        totalVerified: Number(r.verified),
        totalRejected: Number(r.rejected),
        rejectRate:
          Number(r.verified) > 0
            ? Math.round((Number(r.rejected) / Number(r.verified)) * 1000) / 10
            : 0,
        avgVerifierScore: r.avgVerifierScore
          ? Math.round(r.avgVerifierScore * 10) / 10
          : null,
      }));
    });
  }

  // Daily conversation upload count + evaluations created count.
  async getConversationVolume(tenantId: string, from: Date, to: Date) {
    const key = this.buildCacheKey(tenantId, 'conversation_volume', from, to);
    return this.getOrSetCache(key, async () => {
      const db = await this.getDb(tenantId);
      const [convRows, evalRows] = await Promise.all([
        db.$queryRaw<Array<{ date: string; count: bigint }>>`
          SELECT DATE(c."receivedAt") AS date, COUNT(*) AS count
          FROM conversations c
          WHERE c."receivedAt" >= ${from} AND c."receivedAt" <= ${to}
          GROUP BY DATE(c."receivedAt")
          ORDER BY date ASC
        `,
        db.$queryRaw<Array<{ date: string; count: bigint }>>`
          SELECT DATE(e."createdAt") AS date, COUNT(*) AS count
          FROM evaluations e
          WHERE e."createdAt" >= ${from} AND e."createdAt" <= ${to}
          GROUP BY DATE(e."createdAt")
          ORDER BY date ASC
        `,
      ]);

      // Merge by date
      const map: Record<string, { date: string; conversations: number; evaluations: number }> = {};
      for (const r of convRows) {
        const d =
          typeof r.date === 'string' ? r.date : (r.date as Date).toISOString().slice(0, 10);
        map[d] = { date: d, conversations: Number(r.count), evaluations: 0 };
      }
      for (const r of evalRows) {
        const d =
          typeof r.date === 'string' ? r.date : (r.date as Date).toISOString().slice(0, 10);
        if (!map[d]) map[d] = { date: d, conversations: 0, evaluations: 0 };
        map[d].evaluations = Number(r.count);
      }
      return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
    });
  }

  // SLA / turnaround: time from receivedAt → lockedAt per completed evaluation.
  async getSlaReport(tenantId: string, from: Date, to: Date) {
    const key = this.buildCacheKey(tenantId, 'sla_report', from, to);
    return this.getOrSetCache(key, async () => {
      const db = await this.getDb(tenantId);
      const rows = await db.$queryRaw<
        Array<{
          date: string;
          avgTurnaroundHours: number | null;
          minTurnaroundHours: number | null;
          maxTurnaroundHours: number | null;
          count: bigint;
        }>
      >`
        SELECT
          DATE(e."lockedAt") AS date,
          AVG(EXTRACT(EPOCH FROM (e."lockedAt" - c."receivedAt")) / 3600) AS "avgTurnaroundHours",
          MIN(EXTRACT(EPOCH FROM (e."lockedAt" - c."receivedAt")) / 3600) AS "minTurnaroundHours",
          MAX(EXTRACT(EPOCH FROM (e."lockedAt" - c."receivedAt")) / 3600) AS "maxTurnaroundHours",
          COUNT(*) AS count
        FROM evaluations e
        JOIN conversations c ON c.id = e."conversationId"
        WHERE e."workflowState" = 'LOCKED'
          AND e."lockedAt" >= ${from}
          AND e."lockedAt" <= ${to}
        GROUP BY DATE(e."lockedAt")
        ORDER BY date ASC
      `;

      // Overall summary
      const allTurnarounds = rows.filter((r) => r.avgTurnaroundHours !== null);
      const totalCount = allTurnarounds.reduce((s, r) => s + Number(r.count), 0);
      const overallAvg =
        totalCount > 0
          ? allTurnarounds.reduce(
              (s, r) => s + (r.avgTurnaroundHours ?? 0) * Number(r.count),
              0,
            ) / totalCount
          : null;

      return {
        summary: {
          avgTurnaroundHours: overallAvg ? Math.round(overallAvg * 10) / 10 : null,
          totalCompleted: totalCount,
        },
        byDay: rows.map((r) => ({
          date:
            typeof r.date === 'string' ? r.date : (r.date as Date).toISOString().slice(0, 10),
          avgTurnaroundHours: r.avgTurnaroundHours
            ? Math.round(Number(r.avgTurnaroundHours) * 10) / 10
            : null,
          minTurnaroundHours: r.minTurnaroundHours
            ? Math.round(Number(r.minTurnaroundHours) * 10) / 10
            : null,
          maxTurnaroundHours: r.maxTurnaroundHours
            ? Math.round(Number(r.maxTurnaroundHours) * 10) / 10
            : null,
          count: Number(r.count),
        })),
      };
    });
  }

  // Score distribution per form: how many evals fall in each score bucket (0-10,10-20…90-100).
  async getFormScoreDistribution(tenantId: string, from: Date, to: Date) {
    const key = this.buildCacheKey(tenantId, 'form_score_distribution', from, to);
    return this.getOrSetCache(key, async () => {
      const db = await this.getDb(tenantId);
      const rows = await db.$queryRaw<
        Array<{
          formKey: string;
          formName: string;
          bucket: number;
          count: bigint;
        }>
      >`
        SELECT
          fd."formKey",
          fd."name" AS "formName",
          FLOOR(e."finalScore" / 10) * 10 AS bucket,
          COUNT(*) AS count
        FROM evaluations e
        JOIN form_definitions fd ON fd.id = e."formDefinitionId"
        WHERE e."workflowState" = 'LOCKED'
          AND e."finalScore" IS NOT NULL
          AND e."lockedAt" >= ${from}
          AND e."lockedAt" <= ${to}
        GROUP BY fd."formKey", fd."name", bucket
        ORDER BY fd."formKey", bucket ASC
      `;

      // Group by form
      const byForm: Record<
        string,
        {
          formKey: string;
          formName: string;
          buckets: { label: string; min: number; max: number; count: number }[];
        }
      > = {};
      for (const r of rows) {
        if (!byForm[r.formKey]) {
          byForm[r.formKey] = { formKey: r.formKey, formName: r.formName, buckets: [] };
        }
        const min = Math.min(Number(r.bucket), 90);
        byForm[r.formKey].buckets.push({
          label: `${min}–${min + 10}%`,
          min,
          max: min + 10,
          count: Number(r.count),
        });
      }
      return Object.values(byForm);
    });
  }
}
