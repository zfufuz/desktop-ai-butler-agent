import type {
  AgentDecision,
  AgentObservation,
  AgentRun,
  AgentRuntimeEvent,
  AgentToolCall,
  AgentToolDefinition,
} from './protocol'

type DecisionContext = {
  goal: string
  turn: number
  tools: AgentToolDefinition[]
  observations: AgentObservation[]
}

type AgentOrchestratorOptions = {
  tools: AgentToolDefinition[]
  decide: (context: DecisionContext) => Promise<AgentDecision | null>
  execute: (call: AgentToolCall) => Promise<Omit<AgentObservation, 'callId' | 'toolName' | 'startedAt' | 'finishedAt'>>
  synthesize: (context: DecisionContext) => Promise<string>
  onEvent?: (event: AgentRuntimeEvent) => void
  onCheckpoint?: (run: AgentRun) => Promise<unknown> | unknown
  maxTurns?: number
  maxToolCalls?: number
  maxDurationMs?: number
  signal?: AbortSignal
  shouldPause?: () => boolean | Promise<boolean>
}

function createRunId() {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function callFingerprint(call: AgentToolCall) {
  const sortedInput = Object.fromEntries(Object.entries(call.input).sort(([left], [right]) => left.localeCompare(right)))
  return `${call.name}:${JSON.stringify(sortedInput)}`
}

function validateCall(call: AgentToolCall, tools: AgentToolDefinition[]) {
  const tool = tools.find((item) => item.name === call.name)
  if (!tool) return false

  const input = call.input ?? {}
  const allowedKeys = new Set(Object.keys(tool.inputSchema.properties))
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) return false

  const hasValidTypes = Object.entries(input).every(([key, value]) => {
    const schema = tool.inputSchema.properties[key]
    if (!schema) return false
    if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value)
    if (schema.type === 'boolean') return typeof value === 'boolean'
    return typeof value === 'string'
  })
  if (!hasValidTypes) return false

  return (tool.inputSchema.required ?? []).every((key) => {
    const value = input[key]
    return value !== undefined && value !== null && String(value).trim() !== ''
  })
}

export class AgentOrchestrator {
  private readonly options: AgentOrchestratorOptions

  constructor(options: AgentOrchestratorOptions) {
    this.options = options
  }

  private async checkpoint(run: AgentRun) {
    try {
      await this.options.onCheckpoint?.({
        ...run,
        observations: [...run.observations],
      })
    } catch {
      // Persistence must never prevent the Agent from completing the user's task.
    }
  }

  async run(goal: string, checkpoint?: AgentRun): Promise<AgentRun> {
    const startedAt = checkpoint?.startedAt ?? Date.now()
    const run: AgentRun = checkpoint ? {
      ...checkpoint,
      goal,
      status: 'running',
      finishedAt: undefined,
      pauseReason: undefined,
      observations: [...checkpoint.observations],
    } : {
      id: createRunId(),
      goal,
      status: 'running',
      turns: 0,
      startedAt,
      observations: [],
    }
    const executedCalls = new Set(run.observations.map((item) => item.inputFingerprint).filter(Boolean) as string[])
    const maxTurns = Math.max(1, Math.min(this.options.maxTurns ?? 4, 8))
    const maxToolCalls = Math.max(1, Math.min(this.options.maxToolCalls ?? 12, 50))
    const maxDurationMs = Math.max(1000, Math.min(this.options.maxDurationMs ?? 120_000, 600_000))
    let toolCallCount = run.observations.length
    await this.checkpoint(run)

    try {
      for (let turn = Math.max(1, run.turns + (checkpoint ? 1 : 0)); turn <= maxTurns; turn += 1) {
        if (this.options.signal?.aborted) {
          run.status = 'cancelled'
          run.finishedAt = Date.now()
          await this.checkpoint(run)
          this.options.onEvent?.({ type: 'cancelled', turn: run.turns, detail: '任务已取消' })
          return run
        }
        if (Date.now() - startedAt >= maxDurationMs) {
          run.status = 'blocked'
          run.error = '任务超过最长运行时间'
          break
        }
        if (await this.options.shouldPause?.()) {
          run.status = 'paused'
          run.pauseReason = '用户暂停任务'
          await this.checkpoint(run)
          this.options.onEvent?.({ type: 'paused', turn: run.turns, detail: run.pauseReason })
          return run
        }
        run.turns = turn
        await this.checkpoint(run)
        const context: DecisionContext = {
          goal,
          turn,
          tools: this.options.tools,
          observations: run.observations,
        }
        this.options.onEvent?.({ type: 'turn', turn, detail: `第 ${turn} 轮决策` })

        const decision = await this.options.decide(context)
        if (decision?.thought) {
          this.options.onEvent?.({ type: 'decision', turn, detail: decision.thought })
        }

        const calls = (decision?.calls ?? []).filter((call) => {
          const fingerprint = callFingerprint(call)
          if (!validateCall(call, this.options.tools) || executedCalls.has(fingerprint)) return false
          executedCalls.add(fingerprint)
          return true
        })

        if (decision?.final && calls.length === 0) {
          run.status = 'completed'
          run.final = await this.options.synthesize(context)
          run.finishedAt = Date.now()
          await this.checkpoint(run)
          this.options.onEvent?.({ type: 'complete', turn, detail: '模型已完成目标' })
          return run
        }

        if (calls.length === 0) break

        for (const call of calls) {
          if (toolCallCount >= maxToolCalls) {
            run.status = 'blocked'
            run.error = `任务超过最大 Tool 调用次数（${maxToolCalls}）`
            break
          }
          if (this.options.signal?.aborted) {
            run.status = 'cancelled'
            break
          }
          toolCallCount += 1
          const toolStartedAt = Date.now()
          this.options.onEvent?.({ type: 'tool-start', turn, call })
          let result: Omit<AgentObservation, 'callId' | 'toolName' | 'startedAt' | 'finishedAt'>
          const toolDefinition = this.options.tools.find((tool) => tool.name === call.name)
          const maximumAttempts = toolDefinition?.riskLevel === 'low' ? 2 : 1
          let attempts = 0
          while (true) {
            attempts += 1
            try {
              result = await this.options.execute(call)
              break
            } catch (error) {
              if (attempts < maximumAttempts) continue
              result = {
                ok: false,
                summary: attempts > 1 ? `工具执行异常，重试 ${attempts - 1} 次后失败` : '工具执行异常',
                content: error instanceof Error ? error.message : String(error),
              }
              break
            }
          }
          const observation: AgentObservation = {
            ...result,
            callId: call.id,
            toolName: call.name,
            startedAt: toolStartedAt,
            finishedAt: Date.now(),
            attempts,
            inputFingerprint: callFingerprint(call),
          }
          run.observations.push(observation)
          await this.checkpoint(run)
          this.options.onEvent?.({ type: 'tool-finish', turn, observation })
        }
        if (run.status === 'blocked' || run.status === 'cancelled') break
      }

      if (run.status === 'cancelled') {
        run.finishedAt = Date.now()
        await this.checkpoint(run)
        this.options.onEvent?.({ type: 'cancelled', turn: run.turns, detail: '任务已取消' })
        return run
      }
      run.final = await this.options.synthesize({
        goal,
        turn: run.turns,
        tools: this.options.tools,
        observations: run.observations,
      })
      if (run.status !== 'blocked') run.status = run.observations.length > 0 ? 'completed' : 'blocked'
      run.finishedAt = Date.now()
      await this.checkpoint(run)
      this.options.onEvent?.({
        type: 'complete',
        turn: run.turns,
        detail: run.status === 'completed' ? '已根据工具观察生成最终回复' : '没有可用工具观察，已直接回复',
      })
      return run
    } catch (error) {
      run.status = 'failed'
      run.error = error instanceof Error ? error.message : String(error)
      run.finishedAt = Date.now()
      await this.checkpoint(run)
      return run
    }
  }
}
