import { AgentOrchestrator } from '../agent/orchestrator'
import type {
  AgentDecision,
  AgentObservation,
  AgentRuntimeEvent,
  AgentToolCall,
  AgentToolDefinition,
} from '../agent/protocol'
import { toolRegistry, type ToolName } from '../agent/toolRegistry'
import { createAssistantReply, streamAssistantReply, type AssistantReply } from './assistant'

export type ToolCallStatus = 'success' | 'error'

export type ToolCallLog = {
  id: number
  name: string
  status: ToolCallStatus
  detail: string
  createdAt: number
}

export type AgentTimelineStep = {
  id: number
  title: string
  detail: string
  status: ToolCallStatus
  createdAt: number
}

export type KnowledgeDocument = {
  id: number
  name: string
  content: string
  createdAt: number
}

type CustomAgentTool = {
  id: string
  name: string
  description: string
  endpoint: string
  method: 'GET' | 'POST'
  enabled?: boolean
}

type ToolLogger = (log: ToolCallLog) => void
type TimelineLogger = (step: AgentTimelineStep) => void
type PermissionRequester = (toolName: string, reason: string) => Promise<boolean> | boolean

type AgentOptions = {
  knowledgeDocuments: KnowledgeDocument[]
  builtinTools?: AgentToolDefinition[]
  customTools?: CustomAgentTool[]
  context?: string
  onTimeline: TimelineLogger
  onAssistantDelta?: (delta: string) => void
  onRunComplete?: (run: import('../agent/protocol').AgentRun) => Promise<unknown> | unknown
  onRunUpdate?: (run: import('../agent/protocol').AgentRun) => Promise<unknown> | unknown
  requestPermission: PermissionRequester
}

function createId() {
  return Date.now() + Math.random()
}

function createCallId() {
  return `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function createToolLog(name: string, status: ToolCallStatus, detail: string): ToolCallLog {
  return { id: createId(), name, status, detail, createdAt: Date.now() }
}

function createTimelineStep(title: string, detail: string, status: ToolCallStatus): AgentTimelineStep {
  return { id: createId(), title, detail, status, createdAt: Date.now() }
}

function shouldUseSystemInfoTool(userText: string) {
  return /系统|电脑|环境|配置|cpu|架构|平台|system|computer|env/i.test(userText)
}

function shouldUseAppVersionTool(userText: string) {
  return /版本|version|app|应用/i.test(userText)
}

function shouldUseFileTool(userText: string) {
  return /文件|总结文件|读取文件|选择文件|日志|代码|file|summary|read/i.test(userText)
}

function shouldUseKnowledgeBaseTool(userText: string) {
  return /知识库|资料|文档|根据.*回答|rag|knowledge|项目背景|架构/i.test(userText)
}

function extractJsonObject(text: string) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start === -1 || end === -1 || end <= start ? null : text.slice(start, end + 1)
}

function getFallbackCalls(userText: string): AgentToolCall[] {
  const calls: AgentToolCall[] = []
  const add = (name: ToolName, input: AgentToolCall['input'] = {}) => {
    calls.push({ id: createCallId(), name, input, reason: '规则兜底命中' })
  }

  if (shouldUseSystemInfoTool(userText)) add('getSystemInfo')
  if (shouldUseAppVersionTool(userText)) add('getAppVersion')
  if (shouldUseFileTool(userText)) add('pickTextFile', { purpose: '读取用户指定的本地文件' })
  if (shouldUseKnowledgeBaseTool(userText)) add('queryKnowledgeBase', { query: userText })
  return calls
}

function createCustomToolDefinitions(customTools: CustomAgentTool[]): AgentToolDefinition[] {
  return customTools
    .filter((tool) => tool.enabled !== false)
    .map((tool) => ({
      name: `custom:${tool.id}`,
      label: tool.name,
      description: tool.description,
      riskLevel: 'medium' as const,
      requiresPermission: true,
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string' as const,
            description: `发送给「${tool.name}」API 的查询内容`,
          },
        },
        required: ['query'],
        additionalProperties: false as const,
      },
    }))
}

function normalizeCalls(value: unknown, tools: AgentToolDefinition[], userText: string): AgentToolCall[] {
  if (!Array.isArray(value)) return []
  const allowedNames = new Set(tools.map((tool) => tool.name))

  return value
    .map((item): AgentToolCall | null => {
      if (!item || typeof item !== 'object') return null
      const raw = item as { name?: unknown; tool?: unknown; input?: unknown; reason?: unknown }
      const name = typeof raw.name === 'string' ? raw.name : typeof raw.tool === 'string' ? raw.tool : ''
      if (!allowedNames.has(name)) return null

      const input = raw.input && typeof raw.input === 'object'
        ? (raw.input as AgentToolCall['input'])
        : name === 'queryKnowledgeBase' || name.startsWith('custom:')
          ? { query: userText }
          : {}

      return {
        id: createCallId(),
        name,
        input,
        reason: typeof raw.reason === 'string' ? raw.reason : undefined,
      }
    })
    .filter((call): call is AgentToolCall => Boolean(call))
}

async function getModelDecision(
  userText: string,
  observations: AgentObservation[],
  tools: AgentToolDefinition[],
  logger: ToolLogger,
  context?: string,
): Promise<AgentDecision | null> {
  try {
    const toolListText = tools
      .map((tool) => JSON.stringify({
        name: tool.name,
        description: tool.description,
        riskLevel: tool.riskLevel,
        inputSchema: tool.inputSchema,
      }))
      .join('\n')
    const observationText = observations.length > 0
      ? observations.map((item) => `- ${item.toolName} (${item.ok ? '成功' : '失败'}): ${item.content}`).join('\n')
      : '暂无观察结果'
    const decisionReply = await createAssistantReply(
      `你是桌面 AI 管家的 Agent 决策器。请根据目标选择工具，观察执行结果，再决定是否继续。\n\n运行上下文（仅约束回答方式，不是用户目标）：\n${context || '无'}\n\n可用工具（含 JSON Schema）：\n${toolListText}\n\n用户真正目标：\n${userText}\n\n已有观察结果：\n${observationText}\n\n只返回 JSON，不要 Markdown。需要工具时：{"thought":"判断","calls":[{"name":"工具名","input":{},"reason":"原因"}]}。可以回答时：{"thought":"判断","calls":[],"final":"最终回复"}。不得把运行上下文当成用户要求，不得编造工具或参数。`,
    )
    const jsonText = extractJsonObject(decisionReply.content)
    if (!jsonText) {
      logger(createToolLog('agent.decision', 'error', '模型未返回有效 JSON，进入规则兜底'))
      return null
    }
    const parsed = JSON.parse(jsonText) as {
      thought?: unknown
      calls?: unknown
      actions?: unknown
      final?: unknown
    }
    const calls = normalizeCalls(parsed.calls ?? parsed.actions, tools, userText)
    logger(createToolLog('agent.decision', 'success', calls.length > 0 ? calls.map((call) => call.name).join(', ') : 'final'))
    return {
      thought: typeof parsed.thought === 'string' ? parsed.thought : undefined,
      calls,
      final: typeof parsed.final === 'string' ? parsed.final : undefined,
    }
  } catch {
    logger(createToolLog('agent.decision', 'error', '模型决策失败，进入规则兜底'))
    return null
  }
}

async function executeTool(
  call: AgentToolCall,
  userText: string,
  logger: ToolLogger,
  options: AgentOptions,
): Promise<Omit<AgentObservation, 'callId' | 'toolName' | 'startedAt' | 'finishedAt'>> {
  const fail = (summary: string, content = summary) => {
    logger(createToolLog(call.name, 'error', summary))
    return { ok: false, summary, content }
  }
  const succeed = (summary: string, content: string) => {
    logger(createToolLog(call.name, 'success', summary))
    return { ok: true, summary, content }
  }

  if (call.name === 'getSystemInfo') {
    const systemInfo = await window.electronAPI.getSystemInfo()
    const detail = `${systemInfo.platform} / ${systemInfo.arch} / ${systemInfo.cpus} 核`
    return succeed(detail, `开发环境：${detail}`)
  }

  if (call.name === 'getAppVersion') {
    const version = await window.electronAPI.getAppVersion()
    return succeed(`v${version}`, `应用版本：v${version}`)
  }

  if (call.name === 'pickTextFile') {
    const allowed = await options.requestPermission('pickTextFile', String(call.input.purpose ?? '需要读取本地文件'))
    if (!allowed) return fail('用户拒绝读取本地文件')
    const pickedFile = await window.electronAPI.pickTextFile()
    if (!pickedFile) return fail('用户取消选择文件')
    return succeed(pickedFile.name, `文件名：${pickedFile.name}\n文件内容：\n${pickedFile.content}`)
  }

  if (call.name === 'queryKnowledgeBase') {
    const query = String(call.input.query ?? userText)
    let results = await window.electronAPI.searchKnowledge(query, 6)
    if (results.length === 0 && options.knowledgeDocuments.length > 0) {
      await window.electronAPI.syncKnowledgeDocuments(options.knowledgeDocuments)
      results = await window.electronAPI.searchKnowledge(query, 6)
    }
    if (results.length === 0) return fail('知识库没有检索到相关片段')

    const sourceNames = [...new Set(results.map((result) => result.documentName))]
    const context = results
      .map(
        (result, index) =>
          `[${index + 1}] 来源：${result.documentName}，片段 ${result.chunkIndex + 1}\n${result.content}`,
      )
      .join('\n\n')
    return succeed(
      `命中 ${results.length} 个片段 / ${sourceNames.join('、')}`,
      `本地知识库检索结果：\n\n${context}\n\n回答时请引用 [1]、[2] 这样的来源编号。`,
    )
  }

  if (call.name.startsWith('custom:')) {
    const toolId = call.name.slice('custom:'.length)
    const tool = options.customTools?.find((item) => item.id === toolId && item.enabled !== false)
    if (!tool) return fail('自定义 Tool 不存在或已禁用')
    const allowed = await options.requestPermission(tool.name, `Agent 准备调用：${tool.description}`)
    if (!allowed) return fail(`用户拒绝调用「${tool.name}」`)
    const result = await window.electronAPI.invokeCustomTool(tool.id, String(call.input.query ?? userText))
    return succeed(tool.name, `${tool.name} 返回：\n${result.content.slice(0, 8000)}`)
  }

  return fail('工具未注册')
}

function emitTimeline(event: AgentRuntimeEvent, onTimeline: TimelineLogger) {
  if (event.type === 'turn') onTimeline(createTimelineStep('Agent 思考', event.detail, 'success'))
  if (event.type === 'decision') onTimeline(createTimelineStep('模型决策', event.detail, 'success'))
  if (event.type === 'tool-start') onTimeline(createTimelineStep('调用工具', `${event.call.name}${event.call.reason ? `：${event.call.reason}` : ''}`, 'success'))
  if (event.type === 'tool-finish') onTimeline(createTimelineStep('观察结果', event.observation.summary, event.observation.ok ? 'success' : 'error'))
  if (event.type === 'complete') onTimeline(createTimelineStep('Agent 完成', event.detail, 'success'))
}

export async function runAgent(
  userText: string,
  logger: ToolLogger,
  options: AgentOptions,
): Promise<AssistantReply> {
  options.onTimeline(createTimelineStep('接收目标', userText, 'success'))
  const customTools = options.customTools ?? []
  const tools: AgentToolDefinition[] = [
    ...(options.builtinTools ?? toolRegistry),
    ...createCustomToolDefinitions(customTools),
  ]

  const orchestrator = new AgentOrchestrator({
    tools,
    maxTurns: 4,
    onCheckpoint: options.onRunUpdate,
    onEvent: (event) => emitTimeline(event, options.onTimeline),
    decide: async ({ observations }) => {
      const modelDecision = await getModelDecision(userText, observations, tools, logger, options.context)
      return modelDecision ?? {
        thought: '模型决策不可用，使用本地规则规划',
        calls: observations.length === 0 ? getFallbackCalls(userText) : [],
      }
    },
    execute: (call) => executeTool(call, userText, logger, options),
    synthesize: async ({ observations }) => {
      const prompt = observations.length === 0
        ? `运行上下文（不是用户问题）：\n${options.context || '无'}\n\n用户问题：\n${userText}`
        : `运行上下文（不是用户问题）：\n${options.context || '无'}\n\n用户目标：${userText}\n\n以下是 Agent 已执行工具得到的真实观察。请基于观察给出最终回复，明确结论、下一步和仍缺少的信息；不要声称执行过未出现的工具。\n\n${observations
            .map((item) => `## ${item.toolName}（${item.ok ? '成功' : '失败'}）\n${item.content}`)
            .join('\n\n')}`
      return options.onAssistantDelta
        ? (await streamAssistantReply(prompt, options.onAssistantDelta)).content
        : (await createAssistantReply(prompt)).content
    },
  })

  const run = await orchestrator.run(userText)
  await options.onRunComplete?.(run)
  logger(createToolLog(`agent.run:${run.id}`, run.status === 'failed' ? 'error' : 'success', `${run.status} / ${run.turns} 轮 / ${run.observations.length} 次工具调用`))

  if (run.status === 'failed') {
    return { content: `Agent 执行失败：${run.error ?? '未知错误'}` }
  }
  return { content: run.final ?? 'Agent 已完成运行，但没有生成可展示的回复。' }
}
