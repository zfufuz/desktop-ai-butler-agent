export type ToolRiskLevel = 'low' | 'medium' | 'high'

export type ToolParameterSchema = {
  type: 'object'
  properties: Record<
    string,
    {
      type: 'string' | 'number' | 'boolean'
      description: string
    }
  >
  required?: string[]
  additionalProperties: false
}

export type AgentToolDefinition<TName extends string = string> = {
  name: TName
  label: string
  description: string
  riskLevel: ToolRiskLevel
  requiresPermission: boolean
  inputSchema: ToolParameterSchema
}

export type AgentToolCall = {
  id: string
  name: string
  input: Record<string, string | number | boolean>
  reason?: string
}

export type AgentObservation = {
  callId: string
  toolName: string
  ok: boolean
  summary: string
  content: string
  startedAt: number
  finishedAt: number
  attempts?: number
}

export type AgentDecision = {
  thought?: string
  calls: AgentToolCall[]
  final?: string
}

export type AgentRunStatus = 'running' | 'completed' | 'blocked' | 'failed'

export type AgentRun = {
  id: string
  goal: string
  status: AgentRunStatus
  turns: number
  startedAt: number
  finishedAt?: number
  observations: AgentObservation[]
  final?: string
  error?: string
}

export type AgentRuntimeEvent =
  | { type: 'turn'; turn: number; detail: string }
  | { type: 'decision'; turn: number; detail: string }
  | { type: 'tool-start'; turn: number; call: AgentToolCall }
  | { type: 'tool-finish'; turn: number; observation: AgentObservation }
  | { type: 'complete'; turn: number; detail: string }
