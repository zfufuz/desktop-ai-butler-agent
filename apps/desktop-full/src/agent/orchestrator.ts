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
  maxTurns?: number
}

function createRunId() {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function callFingerprint(call: AgentToolCall) {
  return `${call.name}:${JSON.stringify(call.input)}`
}

function validateCall(call: AgentToolCall, tools: AgentToolDefinition[]) {
  const tool = tools.find((item) => item.name === call.name)
  if (!tool) return false

  const input = call.input ?? {}
  const allowedKeys = new Set(Object.keys(tool.inputSchema.properties))
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) return false

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

  async run(goal: string): Promise<AgentRun> {
    const startedAt = Date.now()
    const run: AgentRun = {
      id: createRunId(),
      goal,
      status: 'running',
      turns: 0,
      startedAt,
      observations: [],
    }
    const executedCalls = new Set<string>()
    const maxTurns = Math.max(1, Math.min(this.options.maxTurns ?? 4, 8))

    try {
      for (let turn = 1; turn <= maxTurns; turn += 1) {
        run.turns = turn
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
          this.options.onEvent?.({ type: 'complete', turn, detail: '模型已完成目标' })
          return run
        }

        if (calls.length === 0) break

        for (const call of calls) {
          const toolStartedAt = Date.now()
          this.options.onEvent?.({ type: 'tool-start', turn, call })
          let result: Omit<AgentObservation, 'callId' | 'toolName' | 'startedAt' | 'finishedAt'>
          try {
            result = await this.options.execute(call)
          } catch (error) {
            result = {
              ok: false,
              summary: '工具执行异常',
              content: error instanceof Error ? error.message : String(error),
            }
          }
          const observation: AgentObservation = {
            ...result,
            callId: call.id,
            toolName: call.name,
            startedAt: toolStartedAt,
            finishedAt: Date.now(),
          }
          run.observations.push(observation)
          this.options.onEvent?.({ type: 'tool-finish', turn, observation })
        }
      }

      run.final = await this.options.synthesize({
        goal,
        turn: run.turns,
        tools: this.options.tools,
        observations: run.observations,
      })
      run.status = run.observations.length > 0 ? 'completed' : 'blocked'
      run.finishedAt = Date.now()
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
      return run
    }
  }
}
