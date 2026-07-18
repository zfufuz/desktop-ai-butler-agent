import type { AgentRunSnapshot } from './AgentRunsPanel'
import type { AuditLogEntry } from './AuditLogPanel'

const percent = (value: number, total: number) => total === 0 ? '暂无数据' : `${Math.round(value / total * 100)}%`
const percentile = (values: number[], point: number) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * point) - 1)]
}

export default function MetricsPanel({ runs, logs }: { runs: AgentRunSnapshot[]; logs: AuditLogEntry[] }) {
  const finishedRuns = runs.filter((run) => ['completed', 'blocked', 'failed', 'cancelled'].includes(run.status))
  const completedRuns = finishedRuns.filter((run) => run.status === 'completed')
  const toolLogs = logs.filter((log) => log.category === 'tool' || log.action.includes('tool'))
  const durations = logs.map((log) => log.durationMs).filter((value): value is number => typeof value === 'number')
  const averageTurns = finishedRuns.length === 0 ? null : finishedRuns.reduce((sum, run) => sum + run.turns, 0) / finishedRuns.length
  const failureCounts = logs.filter((log) => log.status === 'failure').reduce<Record<string, number>>((counts, log) => {
    counts[log.category] = (counts[log.category] ?? 0) + 1
    return counts
  }, {})
  const ragModes = logs.filter((log) => log.action === 'knowledge.search').reduce<Record<string, number>>((counts, log) => {
    const mode = String(log.metadata.mode ?? 'unknown')
    counts[mode] = (counts[mode] ?? 0) + 1
    return counts
  }, {})

  return <div className="insight-section">
    <h3>Agent 指标面板</h3>
    <p>所有统计都来自本机 SQLite 运行记录与审计日志，不包含模拟分数。</p>
    <div className="data-stat-grid">
      <span><strong>{percent(completedRuns.length, finishedRuns.length)}</strong><small>任务完成率</small></span>
      <span><strong>{percent(toolLogs.filter((log) => log.status === 'success').length, toolLogs.length)}</strong><small>Tool 成功率</small></span>
      <span><strong>{averageTurns === null ? '暂无数据' : averageTurns.toFixed(1)}</strong><small>平均执行轮数</small></span>
      <span><strong>{durations.length}</strong><small>有耗时记录的事件</small></span>
      <span><strong>{percentile(durations, 0.5) === null ? '暂无数据' : `${percentile(durations, 0.5)} ms`}</strong><small>P50 响应时间</small></span>
      <span><strong>{percentile(durations, 0.95) === null ? '暂无数据' : `${percentile(durations, 0.95)} ms`}</strong><small>P95 响应时间</small></span>
    </div>
    <div className="report-card">
      <strong>失败原因分布</strong>
      <p>{Object.keys(failureCounts).length === 0 ? '暂无失败记录' : Object.entries(failureCounts).map(([key, count]) => `${key}: ${count}`).join(' · ')}</p>
    </div>
    <div className="report-card">
      <strong>RAG 检索模式</strong>
      <p>{Object.keys(ragModes).length === 0 ? '暂无检索记录' : Object.entries(ragModes).map(([key, count]) => `${key}: ${count}`).join(' · ')}</p>
    </div>
  </div>
}
