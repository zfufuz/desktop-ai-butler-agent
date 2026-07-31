// 指标面板：将真实 Agent Run 与 SQLite 审计日志聚合为可核验的运行指标。
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Activity, Clock3, Gauge, Wrench } from 'lucide-react'
import { buildAgentMetrics } from '../lib/agentMetrics'
import type { AgentRunSnapshot } from './AgentRunsPanel'
import type { AuditLogEntry } from './AuditLogPanel'

const displayPercent = (value: number | null) => value === null ? '暂无数据' : `${value}%`
const displayDuration = (value: number | null) => value === null ? '暂无数据' : `${value} ms`

export default function MetricsPanel({
  runs,
  logs,
}: {
  runs: AgentRunSnapshot[]
  logs: AuditLogEntry[]
}) {
  const metrics = buildAgentMetrics(runs, logs)
  const statCards = [
    {
      label: '任务完成率',
      value: displayPercent(metrics.completionRate),
      icon: <Gauge size={17} />,
    },
    {
      label: 'Tool 成功率',
      value: displayPercent(metrics.toolSuccessRate),
      icon: <Wrench size={17} />,
    },
    {
      label: '平均执行轮数',
      value: metrics.averageTurns === null ? '暂无数据' : metrics.averageTurns.toFixed(1),
      icon: <Activity size={17} />,
    },
    {
      label: '首字延迟 P50',
      value: displayDuration(metrics.p50FirstToken),
      icon: <Clock3 size={17} />,
    },
    {
      label: '响应时间 P50',
      value: displayDuration(metrics.p50Duration),
      icon: <Clock3 size={17} />,
    },
    {
      label: '响应时间 P95',
      value: displayDuration(metrics.p95Duration),
      icon: <Clock3 size={17} />,
    },
    {
      label: '累计 Token',
      value: metrics.totalTokens === 0 ? '暂无数据' : metrics.totalTokens.toLocaleString('zh-CN'),
      icon: <Activity size={17} />,
    },
  ]

  return (
    <div className="insight-section metrics-panel">
      <div className="section-heading">
        <div>
          <h3>Agent 指标</h3>
          <p>数据来自本地运行记录和审计日志，不使用模拟分数。</p>
        </div>
      </div>

      <div className="metrics-stat-grid">
        {statCards.map((item) => (
          <div className="metric-stat" key={item.label}>
            <span className="metric-icon">{item.icon}</span>
            <strong>{item.value}</strong>
            <small>{item.label}</small>
          </div>
        ))}
      </div>

      {metrics.estimatedTokenRuns > 0 && (
        <p className="metrics-note">
          其中 {metrics.estimatedTokenRuns} 次模型调用使用估算 Token。
        </p>
      )}

      <div className="metrics-chart-grid">
        <MetricChart title="失败原因" data={metrics.failureData} emptyText="暂无失败记录" color="#dc6b4a" />
        <MetricChart title="RAG 检索模式" data={metrics.ragModeData} emptyText="暂无检索记录" color="#0f8f83" />
      </div>
    </div>
  )
}

function MetricChart({
  title,
  data,
  emptyText,
  color,
}: {
  title: string
  data: Array<{ name: string; value: number }>
  emptyText: string
  color: string
}) {
  return (
    <section className="metric-chart">
      <h4>{title}</h4>
      {data.length === 0 ? (
        <p className="empty-state">{emptyText}</p>
      ) : (
        <div className="metric-chart-canvas">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dce5e3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: '#eef5f3' }} />
              <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}
