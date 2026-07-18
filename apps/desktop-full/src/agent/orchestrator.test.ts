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

  it('blocks calls whose parameter types do not match the schema', async () => {
    const execute = vi.fn()
    const run = await new AgentOrchestrator({
      tools: [searchTool],
      decide: vi.fn().mockResolvedValue({
        calls: [{ id: 'invalid-type', name: 'searchKnowledge', input: { query: 42 } }],
      }),
      execute,
      synthesize: vi.fn().mockResolvedValue('参数类型错误。'),
    }).run('检索')

    expect(execute).not.toHaveBeenCalled()
    expect(run.status).toBe('blocked')
  })

  it('retries a low-risk tool once after an execution exception', async () => {
    const execute = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ ok: true, summary: '重试成功', content: '结果' })
    const decide = vi.fn()
      .mockResolvedValueOnce({ calls: [{ id: 'retry', name: 'searchKnowledge', input: { query: '计划' } }] })
      .mockResolvedValueOnce({ calls: [], final: 'done' })

    const run = await new AgentOrchestrator({
      tools: [searchTool],
      decide,
      execute,
      synthesize: vi.fn().mockResolvedValue('已完成。'),
    }).run('检索计划')

    expect(execute).toHaveBeenCalledTimes(2)
    expect(run.observations[0]).toMatchObject({ ok: true, attempts: 2 })
  })

  it('persists running and completed checkpoints', async () => {
    const checkpoints: string[] = []
    const run = await new AgentOrchestrator({
      tools: [searchTool],
      decide: vi.fn().mockResolvedValue({ calls: [], final: 'done' }),
      execute: vi.fn(),
      synthesize: vi.fn().mockResolvedValue('完成'),
      onCheckpoint: (snapshot) => checkpoints.push(snapshot.status),
    }).run('检查状态')

    expect(run.status).toBe('completed')
    expect(checkpoints[0]).toBe('running')
    expect(checkpoints.at(-1)).toBe('completed')
  })

  it('pauses and resumes from a checkpoint without repeating a tool call', async () => {
    let pause = false
    const execute = vi.fn().mockImplementation(async () => {
      pause = true
      return { ok: true, summary: '已检索', content: '结果' }
    })
    const decide = vi.fn().mockResolvedValue({
      calls: [{ id: 'same', name: 'searchKnowledge', input: { query: '恢复' } }],
    })
    const orchestrator = new AgentOrchestrator({
      tools: [searchTool], decide, execute, synthesize: vi.fn().mockResolvedValue('完成'),
      shouldPause: () => pause,
    })
    const paused = await orchestrator.run('恢复任务')
    expect(paused.status).toBe('paused')
    pause = false
    const resumed = await orchestrator.run('恢复任务', paused)
    expect(resumed.status).toBe('completed')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('cancels before making a decision', async () => {
    const controller = new AbortController()
    controller.abort()
    const decide = vi.fn()
    const run = await new AgentOrchestrator({
      tools: [searchTool], decide, execute: vi.fn(), synthesize: vi.fn(), signal: controller.signal,
    }).run('取消任务')
    expect(run.status).toBe('cancelled')
    expect(decide).not.toHaveBeenCalled()
  })

  it('stops when the tool-call budget is exhausted', async () => {
    let sequence = 0
    const run = await new AgentOrchestrator({
      tools: [searchTool], maxToolCalls: 1,
      decide: vi.fn().mockImplementation(async () => ({
        calls: [{ id: `call-${sequence}`, name: 'searchKnowledge', input: { query: `query-${sequence++}` } }],
      })),
      execute: vi.fn().mockResolvedValue({ ok: true, summary: 'ok', content: 'ok' }),
      synthesize: vi.fn().mockResolvedValue('预算已耗尽'),
    }).run('预算测试')
    expect(run.status).toBe('blocked')
    expect(run.error).toContain('最大 Tool 调用次数')
  })
})
