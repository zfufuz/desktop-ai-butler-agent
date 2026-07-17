import { describe, expect, it, vi } from 'vitest'
import { AgentOrchestrator } from './orchestrator'
import type { AgentDecision, AgentToolDefinition } from './protocol'

const searchTool: AgentToolDefinition = {
  name: 'searchKnowledge',
  label: '检索资料库',
  description: '检索本地资料片段',
  riskLevel: 'low',
  requiresPermission: false,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '检索词' },
    },
    required: ['query'],
    additionalProperties: false,
  },
}

describe('AgentOrchestrator', () => {
  it('executes a valid tool call and synthesizes a final answer', async () => {
    const decide = vi
      .fn<(context: { turn: number }) => Promise<AgentDecision>>()
      .mockResolvedValueOnce({
        calls: [{ id: 'call-1', name: 'searchKnowledge', input: { query: '退款原因' } }],
      })
      .mockResolvedValueOnce({ calls: [], final: 'done' })
    const execute = vi.fn().mockResolvedValue({ ok: true, summary: '命中 1 条', content: '安装失败' })
    const synthesize = vi.fn().mockResolvedValue('退款主要来自安装失败。')

    const run = await new AgentOrchestrator({
      tools: [searchTool],
      decide,
      execute,
      synthesize,
    }).run('分析退款原因')

    expect(run.status).toBe('completed')
    expect(run.turns).toBe(2)
    expect(run.observations).toHaveLength(1)
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'searchKnowledge', input: { query: '退款原因' } }),
    )
    expect(run.final).toBe('退款主要来自安装失败。')
  })

  it('does not execute the same tool call twice', async () => {
    const repeatedCall = { id: 'call-1', name: 'searchKnowledge', input: { query: '预算' } }
    const decide = vi.fn().mockResolvedValue({ calls: [repeatedCall] })
    const execute = vi.fn().mockResolvedValue({ ok: true, summary: '已检索', content: '预算数据' })

    const run = await new AgentOrchestrator({
      tools: [searchTool],
      decide,
      execute,
      synthesize: vi.fn().mockResolvedValue('已完成预算分析。'),
      maxTurns: 4,
    }).run('分析预算')

    expect(execute).toHaveBeenCalledTimes(1)
    expect(run.status).toBe('completed')
    expect(run.observations).toHaveLength(1)
  })

  it('blocks calls with missing required parameters', async () => {
    const execute = vi.fn()
    const run = await new AgentOrchestrator({
      tools: [searchTool],
      decide: vi.fn().mockResolvedValue({
        calls: [{ id: 'invalid', name: 'searchKnowledge', input: {} }],
      }),
      execute,
      synthesize: vi.fn().mockResolvedValue('缺少检索词。'),
    }).run('检索')

    expect(execute).not.toHaveBeenCalled()
    expect(run.status).toBe('blocked')
    expect(run.observations).toHaveLength(0)
  })
})
