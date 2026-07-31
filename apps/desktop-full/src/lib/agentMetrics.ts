import type { AgentRunSnapshot } from '../components/AgentRunsPanel'
import type { AuditLogEntry } from '../components/AuditLogPanel'

export function percentile(values: number[], point: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * point) - 1)]
}

export function ratio(value: number, total: number): number | null {
  return total === 0 ? null : Math.round((value / total) * 100)
}

export function buildAgentMetrics(runs: AgentRunSnapshot[], logs: AuditLogEntry[]) {
  const finishedRuns = runs.filter((run) =>
    ['completed', 'blocked', 'failed', 'cancelled'].includes(run.status),
  )
  const completedRuns = finishedRuns.filter((run) => run.status === 'completed')
  const toolLogs = logs.filter((log) => log.category === 'tool' || log.action.includes('tool'))
  const durations = logs
    .map((log) => log.durationMs)
    .filter((value): value is number => typeof value === 'number')
  const modelLogs = logs.filter((log) =>
    ['chat.stream', 'chat.complete'].includes(log.action),
  )
  const firstTokenDurations = modelLogs
    .map((log) => Number(log.metadata.firstTokenMs))
    .filter(Number.isFinite)

  const failureCounts = logs
    .filter((log) => log.status === 'failure')
    .reduce<Record<string, number>>((counts, log) => {
      counts[log.category] = (counts[log.category] ?? 0) + 1
      return counts
    }, {})

  const ragModes = logs
    .filter((log) => log.action === 'knowledge.search')
    .reduce<Record<string, number>>((counts, log) => {
      const mode = String(log.metadata.mode ?? 'unknown')
      counts[mode] = (counts[mode] ?? 0) + 1
      return counts
    }, {})

  return {
    completionRate: ratio(completedRuns.length, finishedRuns.length),
    toolSuccessRate: ratio(
      toolLogs.filter((log) => log.status === 'success').length,
      toolLogs.length,
    ),
    averageTurns:
      finishedRuns.length === 0
        ? null
        : finishedRuns.reduce((sum, run) => sum + run.turns, 0) / finishedRuns.length,
    p50Duration: percentile(durations, 0.5),
    p95Duration: percentile(durations, 0.95),
    p50FirstToken: percentile(firstTokenDurations, 0.5),
    totalTokens: modelLogs.reduce(
      (sum, log) => sum + (Number(log.metadata.totalTokens) || 0),
      0,
    ),
    estimatedTokenRuns: modelLogs.filter(
      (log) => log.metadata.tokenCountEstimated === true,
    ).length,
    failureData: Object.entries(failureCounts).map(([name, value]) => ({ name, value })),
    ragModeData: Object.entries(ragModes).map(([name, value]) => ({ name, value })),
  }
}
