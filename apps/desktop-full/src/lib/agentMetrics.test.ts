import { describe, expect, it } from 'vitest'
import type { AgentRunSnapshot } from '../components/AgentRunsPanel'
import type { AuditLogEntry } from '../components/AuditLogPanel'
import { buildAgentMetrics, percentile, ratio } from './agentMetrics'

const run = (
  status: AgentRunSnapshot['status'],
  turns: number,
): AgentRunSnapshot => ({
  id: `${status}-${turns}`,
  goal: '测试任务',
  status,
  turns,
  startedAt: 100,
  finishedAt: 200,
  observations: [],
})

const log = (entry: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: Math.random().toString(36),
  createdAt: Date.now(),
  level: 'info',
  category: 'agent',
  action: 'agent.run',
  summary: '测试日志',
  status: 'success',
  metadata: {},
  ...entry,
})

describe('agent metrics', () => {
  it('calculates percentiles and protects empty ratios', () => {
    expect(percentile([40, 10, 20, 30], 0.5)).toBe(20)
    expect(percentile([], 0.95)).toBeNull()
    expect(ratio(3, 4)).toBe(75)
    expect(ratio(0, 0)).toBeNull()
  })

  it('aggregates runs, tools, latency, tokens and RAG modes', () => {
    const metrics = buildAgentMetrics(
      [run('completed', 2), run('failed', 4), run('running', 1)],
      [
        log({ category: 'tool', action: 'tool.call', status: 'success', durationMs: 20 }),
        log({ category: 'tool', action: 'tool.call', status: 'failure', durationMs: 100 }),
        log({
          action: 'chat.stream',
          durationMs: 60,
          metadata: { firstTokenMs: 30, totalTokens: 120 },
        }),
        log({ category: 'knowledge', action: 'knowledge.search', metadata: { mode: 'hybrid' } }),
      ],
    )

    expect(metrics.completionRate).toBe(50)
    expect(metrics.toolSuccessRate).toBe(50)
    expect(metrics.averageTurns).toBe(3)
    expect(metrics.p50Duration).toBe(60)
    expect(metrics.p95Duration).toBe(100)
    expect(metrics.totalTokens).toBe(120)
    expect(metrics.ragModeData).toEqual([{ name: 'hybrid', value: 1 }])
    expect(metrics.failureData).toEqual([{ name: 'tool', value: 1 }])
  })
})
