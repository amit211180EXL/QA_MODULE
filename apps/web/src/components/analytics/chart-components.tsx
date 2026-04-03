'use client';

import {
  LineChart as RechartsLineChart,
  Line,
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { ScoreTrendDay, ScoreTrendChannel, AiUsageTrendPoint } from '@/lib/analytics-api';

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-48 items-center justify-center text-sm text-slate-400">{label}</div>
  );
}

//  Score Trend Chart (by day)
export function ScoreTrendByDayChart({ data }: { data: ScoreTrendDay[] | undefined }) {
  if (!data || data.length === 0) return <EmptyChart label="No data" />;
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsLineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="day" />
        <YAxis domain={[0, 100]} />
        <Tooltip />
        <Legend />
        <Line
          type="monotone"
          dataKey="avgScore"
          stroke="#0ea5e9"
          strokeWidth={2}
          name="Avg Score"
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="passRate"
          stroke="#10b981"
          strokeWidth={2}
          name="Pass Rate"
          dot={false}
        />
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}

// Score Trend Chart (by channel)
export function ScoreTrendByChannelChart({ data }: { data: ScoreTrendChannel[] | undefined }) {
  if (!data || data.length === 0) return <EmptyChart label="No data" />;
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsBarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="channel" />
        <YAxis domain={[0, 100]} />
        <Tooltip />
        <Legend />
        <Bar dataKey="avgScore" fill="#0ea5e9" name="Avg Score" />
        <Bar dataKey="passRate" fill="#10b981" name="Pass Rate" />
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}

// AI Usage Trend Chart
export function AiUsageTrendChart({ data }: { data: AiUsageTrendPoint[] | undefined }) {
  if (!data || data.length === 0) return <EmptyChart label="No data" />;
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsLineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="day" />
        <YAxis yAxisId="left" />
        <YAxis yAxisId="right" orientation="right" />
        <Tooltip />
        <Legend />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="evaluations"
          stroke="#8b5cf6"
          name="Evaluations"
          dot={false}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="avgCost"
          stroke="#f59e0b"
          name="Avg Cost"
          dot={false}
        />
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}

// Agent Performance Chart
export function AgentPerformanceChart({
  data,
}: {
  data: Array<{ agentName: string; avgScore: number; passRate: number }> | undefined;
}) {
  if (!data || data.length === 0) return <EmptyChart label="No data" />;
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsBarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="agentName" angle={-45} textAnchor="end" height={100} />
        <YAxis domain={[0, 100]} />
        <Tooltip />
        <Legend />
        <Bar dataKey="avgScore" fill="#0ea5e9" name="Avg Score" />
        <Bar dataKey="passRate" fill="#10b981" name="Pass Rate" />
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}

// Deviation Trend Chart
export function DeviationTrendChart({
  data,
}: {
  data: Array<{ period: string; avgDeviation: number; threshold: number }> | undefined;
}) {
  if (!data || data.length === 0) return <EmptyChart label="No data" />;
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsLineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="period" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Line
          type="monotone"
          dataKey="avgDeviation"
          stroke="#ef4444"
          name="Avg Deviation"
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="threshold"
          stroke="#6b7280"
          name="Threshold"
          strokeDasharray="5 5"
          dot={false}
        />
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}
