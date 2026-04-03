'use client';

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import type { OverviewKpis, AgentPerformanceRow, QuestionDeviationRow } from '@/lib/analytics-api';

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-48 items-center justify-center text-sm text-slate-400">{label}</div>
  );
}

interface AnalyticsChartsSectionProps {
  trendChartData: Array<{ date: string; 'AI↔QA': number; 'QA↔Verifier': number }>;
  agentChartData: Array<{
    name: string;
    fullName: string;
    avgScore: number;
    passRate: number;
    total: number;
  }>;
  agents: AgentPerformanceRow[] | undefined;
  questionDevs: QuestionDeviationRow[] | undefined;
  kpis: OverviewKpis | undefined;
  fromDate: string;
  toDate: string;
  trendsLoading: boolean;
  agentsLoading: boolean;
  questionDevsLoading: boolean;
  downloadCSV: (
    rows: AgentPerformanceRow[],
    kpis: OverviewKpis | undefined,
    fromDate: string,
    toDate: string,
  ) => void;
  downloadPDF: () => void;
}

export function AnalyticsChartsSection({
  trendChartData,
  agentChartData,
  agents,
  questionDevs,
  kpis,
  fromDate,
  toDate,
  trendsLoading,
  agentsLoading,
  questionDevsLoading,
  downloadCSV,
  downloadPDF,
}: AnalyticsChartsSectionProps) {
  return (
    <>
      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Deviation trends line chart */}
        <Card shadow="sm">
          <CardHeader>
            <h3 className="text-lg font-semibold text-slate-900">Deviation Trends</h3>
            <p className="mt-1 text-sm text-slate-600">AI↔QA and QA↔Verifier per day</p>
          </CardHeader>
          <CardBody>
            {trendsLoading ? (
              <div className="flex h-48 items-center justify-center">
                <span className="animate-pulse text-sm text-slate-400">Loading…</span>
              </div>
            ) : trendChartData.length === 0 ? (
              <EmptyChart label="No deviation data for this period." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart
                  data={trendChartData}
                  margin={{ top: 4, right: 16, left: -8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(value: any) => [
                      typeof value === 'number' ? value.toFixed(2) : String(value ?? ''),
                      '',
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="AI↔QA"
                    stroke="#818cf8"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="QA↔Verifier"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>

        {/* Agent pass rate bar chart */}
        <Card shadow="sm">
          <CardHeader>
            <h3 className="text-lg font-semibold text-slate-900">Agent Pass Rate</h3>
            <p className="mt-1 text-sm text-slate-600">% of evaluations that passed</p>
          </CardHeader>
          <CardBody>
            {agentsLoading ? (
              <div className="flex h-48 items-center justify-center">
                <span className="animate-pulse text-sm text-slate-400">Loading…</span>
              </div>
            ) : agentChartData.length === 0 ? (
              <EmptyChart label="No agent data for this period." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={agentChartData}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: -8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={64} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(
                      value: any,
                      _name: any,
                      props: { payload?: { fullName?: string; total?: number } },
                    ) => [
                      `${value ?? 0}% (${props.payload?.total ?? 0} evals)`,
                      props.payload?.fullName ?? '',
                    ]}
                  />
                  <Bar dataKey="passRate" radius={[0, 4, 4, 0]}>
                    {agentChartData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={
                          entry.passRate >= 80
                            ? '#22c55e'
                            : entry.passRate >= 60
                              ? '#f59e0b'
                              : '#ef4444'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Agent performance table */}
      <Card shadow="sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Agent Performance</h3>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={!agents || agents.length === 0}
                onClick={() => downloadCSV(agents ?? [], kpis, fromDate, toDate)}
              >
                <Download className="mr-1.5 h-4 w-4" />
                Export CSV
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!agents || agents.length === 0}
                onClick={downloadPDF}
              >
                <Download className="mr-1.5 h-4 w-4" />
                Export PDF
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardBody>
          {agentsLoading ? (
            <div className="text-center text-sm text-slate-400">Loading…</div>
          ) : !agents || agents.length === 0 ? (
            <div className="text-center text-sm text-slate-400 py-8">
              No evaluations completed in this period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                      Agent
                    </th>
                    <th className="px-5 py-3 text-right text-2xs font-semibold uppercase tracking-wide text-slate-500">
                      Evaluations
                    </th>
                    <th className="px-5 py-3 text-right text-2xs font-semibold uppercase tracking-wide text-slate-500">
                      Avg Score
                    </th>
                    <th className="px-5 py-3 text-right text-2xs font-semibold uppercase tracking-wide text-slate-500">
                      Pass Rate
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {agents.map((row) => (
                    <tr key={row.agentId} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-800">{row.agentName}</td>
                      <td className="px-5 py-3 text-right text-slate-700">
                        {row.totalEvaluations}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-slate-700">
                        {row.avgScore.toFixed(1)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Badge
                          variant={
                            row.passRate >= 80
                              ? 'success'
                              : row.passRate >= 60
                                ? 'warning'
                                : 'danger'
                          }
                          size="md"
                        >
                          {row.passRate.toFixed(1)}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Question override analysis */}
      <Card shadow="sm">
        <CardHeader>
          <h3 className="text-lg font-semibold text-slate-900">Top Overridden Questions</h3>
          <p className="mt-1 text-sm text-slate-600">
            Questions QA reviewers most frequently changed from the AI answer
          </p>
        </CardHeader>
        <CardBody>
          {questionDevsLoading ? (
            <div className="text-center text-sm text-slate-400">Loading…</div>
          ) : !questionDevs || questionDevs.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">
              No question overrides recorded in this period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
                      Question Key
                    </th>
                    <th className="px-5 py-3 text-right text-2xs font-semibold uppercase tracking-wide text-slate-500">
                      AI → QA Overrides
                    </th>
                    <th className="px-5 py-3 text-right text-2xs font-semibold uppercase tracking-wide text-slate-500">
                      Override Rate
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {questionDevs.slice(0, 10).map((row) => (
                    <tr key={row.questionKey} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-mono text-xs text-slate-700">
                        {row.questionKey}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-700">{row.overrideCount}</td>
                      <td className="px-5 py-3 text-right">
                        <Badge variant={row.overrideRate >= 20 ? 'warning' : 'default'} size="md">
                          {row.overrideRate.toFixed(1)}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}
