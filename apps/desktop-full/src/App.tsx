import { useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  CalendarPlus,
  Download,
  FileText,
  ListChecks,
  Pause,
  Pin,
  Plane,
  Play,
  ReceiptText,
  Settings,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import './App.css'
import AvatarPanel from './components/AvatarPanel'
import AgentRunsPanel, { type AgentRunSnapshot } from './components/AgentRunsPanel'
import MetricsPanel from './components/MetricsPanel'
import AuditLogPanel, {
  type AuditLogEntry,
  type AuditLogFilters,
} from './components/AuditLogPanel'
import ChatInput from './components/ChatInput'
import EvalPanel from './components/EvalPanel'
import KnowledgePanel, {
  type KnowledgeDocumentSummary,
  type KnowledgeSearchResult,
} from './components/KnowledgePanel'
import MessageList from './components/MessageList'
import { createAssistantReply } from './services/assistant'
import {
  runAgent,
  type AgentTimelineStep,
  type KnowledgeDocument,
  type ToolCallLog,
} from './services/agent'
import { toolRegistry } from './agent/toolRegistry'
import type { AgentRun } from './agent/protocol'
import { wrapUntrustedCollection, wrapUntrustedContent } from './agent/security'
import { getSkillDefinition, skillRegistry, type SkillId } from './skills/skillRegistry'
import type { AssistantStatus, Message } from './type'

type ProductMode = 'user' | 'developer'
type PendingFileReadStep = 'awaitingConsent' | 'awaitingScope' | null
type PendingTripStep = 'awaitingDetails' | null
type SettingsPage = 'home' | 'provider' | 'integrations' | 'rag' | 'skill' | 'tool' | 'installed' | 'extensions' | 'advanced' | 'data'
type WorkspacePage = 'home' | 'data' | 'knowledge' | 'runs' | 'metrics' | 'eval' | 'logs' | 'reports' | 'plans' | 'activity' | 'memory'
type ButlerScenario = 'file' | 'trip' | 'study' | 'workReport' | 'expense' | 'today'
type RegistryInventoryKind = 'skill' | 'tool'
type ProviderType = 'mock' | 'zhipu' | 'openai-compatible'

function getRegistryInventoryKind(text: string): RegistryInventoryKind | null {
  const asksForList = /有什么|有哪些|列出|查看|当前|已安装|支持|能用/i.test(text)
  if (!asksForList) return null
  if (/skill|技能/i.test(text)) return 'skill'
  if (/tool|工具/i.test(text)) return 'tool'
  return null
}

type ModelProviderConfig = {
  id: string
  name: string
  type: ProviderType
  model: string
  apiKey?: string
  baseUrl?: string
}

type RagConfig = {
  embeddingEnabled: boolean
  embeddingProviderId: string
  embeddingModel: string
  embeddingBaseUrl: string
  rerankerEnabled: boolean
  rerankerModel: string
  rerankerBaseUrl: string
  topK: number
}

type CustomSkillConfig = {
  id: string
  name: string
  description: string
  prompt: string
  enabled?: boolean
  source?: 'manual' | 'extension'
}

type CustomToolConfig = {
  id: string
  name: string
  description: string
  endpoint: string
  method: 'GET' | 'POST'
  apiKey?: string
  apiKeyPlacement?: 'none' | 'bearer' | 'query' | 'header'
  apiKeyName?: string
  headers?: Record<string, string>
  timeoutMs?: number
  retries?: number
  version?: string
  inputSchema?: { properties: Record<string, { type: 'string' | 'number' | 'boolean'; description?: string }>; required?: string[] }
  queryParams?: Record<string, string>
  bodyParams?: Record<string, string>
  responsePath?: string
  enabled?: boolean
  source?: 'manual' | 'extension'
}

type AgentPlatformConfig = {
  activeProviderId: string
  providers: ModelProviderConfig[]
  customSkills: CustomSkillConfig[]
  customTools: CustomToolConfig[]
  rag: RagConfig
  integrations: {
    amapApiKey?: string
  }
  deletedBuiltinToolIds?: string[]
}

type LocalTextFile = {
  id?: number
  name: string
  path: string
  content: string
}

type PlanStatus = 'active' | 'done'

type ButlerReport = {
  id: string
  title: string
  summary: string
  content: string
  source: string
  createdAt: number
}

type ButlerPlan = {
  id: string
  title: string
  description: string
  status: PlanStatus
  checkins: number
  lastCheckinAt?: number
  reminderTime?: string
  lastReminderDate?: string
  priority: 'low' | 'medium' | 'high'
  dueDate?: string
  recurrence: 'none' | 'daily' | 'weekly'
  progress: number
  nextAction?: string
  completedAt?: number
  createdAt: number
  updatedAt: number
}

type ButlerActivity = {
  id: string
  type: 'report' | 'plan' | 'checkin' | 'note'
  text: string
  createdAt: number
}

type ButlerWorkspaceData = {
  reports: ButlerReport[]
  plans: ButlerPlan[]
  activities: ButlerActivity[]
}

type SavedReportResult = {
  report: ButlerReport
  createdPlans: ButlerPlan[]
}

type TripDraft = {
  origin?: string
  destination?: string
  dateText?: string
  nights?: string
  purpose?: string
}

type TripResultCard = {
  title: string
  subtitle: string
  facts: string[]
  content: string
  draft: TripDraft
  savedToPlan?: boolean
}

type PendingReportCard = {
  title: string
  summary: string
  content: string
  source: string
  planCount: number
}

type BuiltinOverride = {
  name?: string
  description?: string
  enabled?: boolean
  deleted?: boolean
}

type BuiltinOverrideMap = Record<string, BuiltinOverride>

type MemoryNote = {
  id: string
  text: string
  category: 'preference' | 'goal' | 'context' | 'fact'
  pinned: boolean
  expiresAt?: number
  createdAt: number
  updatedAt: number
}

function createMessageId() {
  return Date.now() + Math.random()
}

function parseOptionalJsonObject<T>(text: string, label: string): T | undefined {
  if (!text.trim()) return undefined
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label} 必须是 JSON 对象`)
  return parsed as T
}

function createLocalId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function getAssistantStatusText(status: AssistantStatus) {
  return status === 'thinking' ? '处理中' : '待命'
}

function readJsonFromStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

function isPositiveReply(text: string) {
  return /确认|可以|好的|好|是|要|读取|读吧|同意|yes|ok/i.test(text)
}

function isNegativeReply(text: string) {
  return /不用|不要|取消|算了|否|不读|no/i.test(text)
}

function isAllFilesScope(text: string) {
  return /全部|所有|整个|文件夹|目录|all/i.test(text)
}

function isSingleFileScope(text: string) {
  return /单独|单个|一个|某个|选择|指定|single/i.test(text)
}

function isFileReadRequest(text: string) {
  return /读取|读|打开|分析|看看|查看/.test(text) && /文件|文档|资料|桌面|csv|excel|xlsx|word|docx|ppt|pptx|pdf|图片|png|jpg|txt|md|json|log/i.test(text)
}

function hasExplicitFileTarget(text: string) {
  return /[A-Za-z]:\\|\.(txt|md|json|log|csv|tsv|xlsx|docx|pptx|pdf|png|jpe?g|gif|webp|html|xml|ya?ml|sql|js|ts|tsx|css|py)|《.+》|“.+”|".+"/i.test(text)
}

function isRealtimeInfoRequest(text: string) {
  return /天气|气温|温度|新闻|汇率|股票|股价|快递|航班|实时|今天|明天/.test(text)
}

function scoreCustomToolForText(tool: CustomToolConfig, text: string) {
  const target = `${tool.name} ${tool.description} ${tool.endpoint}`.toLowerCase()
  const query = text.toLowerCase()
  let score = 0

  if (query.includes('天气') && target.includes('天气')) {
    score += 6
  }

  if ((query.includes('汇率') || query.includes('美元')) && target.includes('汇率')) {
    score += 6
  }

  if ((query.includes('股票') || query.includes('股价')) && target.includes('股票')) {
    score += 6
  }

  if (query.includes('新闻') && target.includes('新闻')) {
    score += 6
  }

  if ((query.includes('出差') || query.includes('交通') || query.includes('高铁') || query.includes('航班')) && /交通|高铁|火车|航班|飞机|路线|train|flight|route/.test(target)) {
    score += 6
  }

  if ((query.includes('出差') || query.includes('酒店') || query.includes('住宿')) && /酒店|住宿|hotel/.test(target)) {
    score += 6
  }

  const queryTerms = query.match(/[\u4e00-\u9fa5]{2,}|[a-zA-Z]{3,}/g) ?? []
  for (const term of queryTerms) {
    if (target.includes(term)) {
      score += 1
    }
  }

  return score
}

function findBestCustomTool(tools: CustomToolConfig[], text: string) {
  const rankedTools = tools
    .filter((tool) => tool.enabled !== false)
    .map((tool) => ({ tool, score: scoreCustomToolForText(tool, text) }))
    .sort((a, b) => b.score - a.score)

  return rankedTools[0]?.score > 0 ? rankedTools[0].tool : null
}

function isTripPlanningRequest(text: string) {
  return /出差|差旅|行程|订票|酒店|住宿|高铁|火车|飞机|航班|交通|报销预算/.test(text)
}

function normalizeTripDate(value?: string) {
  if (!value) return value
  const compact = value.match(/^(20\d{2})(\d{2})(\d{2})$/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  const dashed = value.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/)
  if (dashed) return `${dashed[1]}-${dashed[2].padStart(2, '0')}-${dashed[3].padStart(2, '0')}`
  return value
}

function sanitizeTripAdvice(content: string) {
  const sanitized = content.split(/\r?\n/).filter((line) =>
    !/配置.*(?:Tool|工具)|未配置.*(?:Tool|工具)|API.*(?:错误|问题|失败)|无法确定.*(?:交通|天气)|ENGINE_RESPONSE|infocode/i.test(line),
  ).join('\n').trim()
  return sanitized || '## 行前待办\n- 确认出发时间与证件\n- 根据天气准备衣物\n## 报销材料\n- 保存交通与住宿凭证'
}

function extractTripDraft(text: string): TripDraft {
  const destinationMatch =
    text.match(/去([^，。,.?\s]{2,12})(?:出差|开会|拜访|培训|参会)?/) ??
    text.match(/到([^，。,.?\s]{2,12})(?:出差|开会|拜访|培训|参会)?/)
  const originMatch = text.match(/从([^，。,.?\s]{2,12})(?:出发|去|到)/)
  const dateMatch = text.match(/(今天|明天|后天|下周[一二三四五六日天]?|\d{1,2}月\d{1,2}[日号]?|\d{8}|\d{4}-\d{1,2}-\d{1,2})/)
  const nightsMatch = text.match(/住(\d+)晚|(\d+)晚|当天来回/)
  const purposeMatch = text.match(/(?:为了|去|参加|拜访|开)([^，。,.?\s]{2,18})(?:出差|会议|客户|培训)?/)

  return {
    origin: originMatch?.[1],
    destination: destinationMatch?.[1],
    dateText: normalizeTripDate(dateMatch?.[1]),
    nights: nightsMatch?.[1] ?? nightsMatch?.[2] ?? (text.includes('当天来回') ? '0' : undefined),
    purpose: purposeMatch?.[1],
  }
}

function mergeTripDraft(currentDraft: TripDraft, nextDraft: TripDraft) {
  return {
    origin: nextDraft.origin ?? currentDraft.origin,
    destination: nextDraft.destination ?? currentDraft.destination,
    dateText: normalizeTripDate(nextDraft.dateText ?? currentDraft.dateText),
    nights: nextDraft.nights ?? currentDraft.nights,
    purpose: nextDraft.purpose ?? currentDraft.purpose,
  }
}

function getMissingTripFields(draft: TripDraft) {
  const missingFields: string[] = []
  if (!draft.origin) {
    missingFields.push('出发城市')
  }
  if (!draft.destination) {
    missingFields.push('目的地')
  }
  if (!draft.dateText) {
    missingFields.push('出发日期')
  }
  if (!draft.nights) {
    missingFields.push('住宿晚数')
  }
  return missingFields
}

function findTripTool(tools: CustomToolConfig[], kind: 'weather' | 'transport' | 'hotel') {
  const keywords = {
    weather: /天气|气温|weather/,
    transport: /交通|高铁|火车|航班|飞机|路线|train|flight|route/,
    hotel: /酒店|住宿|hotel/,
  }

  return tools.find((tool) => {
    const target = `${tool.name} ${tool.description} ${tool.endpoint}`.toLowerCase()
    return tool.enabled !== false && !tool.id.startsWith('builtin-amap-') && keywords[kind].test(target)
  })
}

function parseImportedSkill(file: LocalTextFile) {
  const rawContent = file.content.trim()

  try {
    const parsed = JSON.parse(rawContent) as Partial<CustomSkillConfig>
    return {
      name: parsed.name?.trim() || file.name.replace(/\.[^.]+$/, ''),
      description: parsed.description?.trim() || '从本地文件导入的 Prompt Skill',
      prompt: parsed.prompt?.trim() || rawContent,
    }
  } catch {
    const lines = rawContent.split(/\r?\n/)
    const heading = lines.find((line) => line.trim().startsWith('#'))?.replace(/^#+\s*/, '').trim()
    const firstTextLine = lines.find((line) => line.trim() && !line.trim().startsWith('#'))?.trim()

    return {
      name: heading || file.name.replace(/\.[^.]+$/, ''),
      description: firstTextLine?.slice(0, 80) || '从本地文件导入的 Prompt Skill',
      prompt: rawContent,
    }
  }
}

function parseImportedTool(file: LocalTextFile) {
  const parsed = JSON.parse(file.content) as Partial<CustomToolConfig>
  const method: 'GET' | 'POST' = parsed.method === 'GET' ? 'GET' : 'POST'

  return {
    name: parsed.name?.trim() || file.name.replace(/\.[^.]+$/, ''),
    description: parsed.description?.trim() || '从本地 JSON 导入的 HTTP API Tool',
    endpoint: parsed.endpoint?.trim() || '',
    method,
    apiKey: parsed.apiKey?.trim() || '',
    apiKeyPlacement: parsed.apiKeyPlacement ?? 'bearer',
    apiKeyName: parsed.apiKeyName?.trim() || '',
    timeoutMs: parsed.timeoutMs ?? 20000,
    retries: parsed.retries ?? 0,
    version: parsed.version ?? '1.0.0',
    headersJson: parsed.headers ? JSON.stringify(parsed.headers, null, 2) : '',
    inputSchemaJson: parsed.inputSchema ? JSON.stringify(parsed.inputSchema, null, 2) : '',
    queryParamsJson: parsed.queryParams ? JSON.stringify(parsed.queryParams, null, 2) : '',
    bodyParamsJson: parsed.bodyParams ? JSON.stringify(parsed.bodyParams, null, 2) : '',
    responsePath: parsed.responsePath ?? '',
  }
}

function createReportSummary(content: string) {
  return content
    .replace(/[#>*_\-`]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length >= 10)
    ?.slice(0, 120) ?? '已生成一份分析报告，可打开悬浮窗查看重点。'
}

function extractPlanDraftsFromReport(content: string) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•\d.、\s]+/, '').trim())
    .filter((line) => line.length >= 6)

  const keywords = /计划|待办|建议|下一步|完成|检查|整理|复习|生成|分析|优化|记录/
  return lines
    .filter((line) => keywords.test(line))
    .slice(0, 5)
    .map((line) => ({
      title: line.slice(0, 32),
      description: line,
    }))
}

function formatShortTime(value?: number) {
  if (!value) {
    return '未打卡'
  }

  return new Date(value).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  })
}

function getDateKey(value = new Date()) {
  return value.toISOString().slice(0, 10)
}

function isSameDay(timestamp?: number) {
  if (!timestamp) {
    return false
  }

  return getDateKey(new Date(timestamp)) === getDateKey()
}

function getDaysSince(timestamp?: number) {
  if (!timestamp) {
    return Number.POSITIVE_INFINITY
  }

  return Math.floor((Date.now() - timestamp) / 86400000)
}

function isPlanStale(plan: ButlerPlan) {
  if (plan.status === 'done') {
    return false
  }

  const baseTime = plan.lastCheckinAt ?? plan.createdAt
  return getDaysSince(baseTime) >= 2
}

function App() {
  const [isElectronReady, setIsElectronReady] = useState(() => Boolean(window.electronAPI))
  const mode: ProductMode = 'user'
  const [input, setInput] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<LocalTextFile[]>([])
  const [assistantStatus, setAssistantStatus] = useState<AssistantStatus>('idle')
  const [appName, setAppName] = useState(() => window.electronAPI?.getAppName() ?? '桌面 AI 管家')
  const [appVersion, setAppVersion] = useState('')
  const [systemInfoText, setSystemInfoText] = useState('')
  const [toolLogs, setToolLogs] = useState<ToolCallLog[]>([])
  const [agentTimeline, setAgentTimeline] = useState<AgentTimelineStep[]>([])
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>(() =>
    readJsonFromStorage('ai-butler:knowledgeDocuments', []),
  )
  const [knowledgeIndex, setKnowledgeIndex] = useState<KnowledgeDocumentSummary[]>([])
  const [knowledgeQuery, setKnowledgeQuery] = useState('')
  const [knowledgeResults, setKnowledgeResults] = useState<KnowledgeSearchResult[]>([])
  const [agentRuns, setAgentRuns] = useState<AgentRunSnapshot[]>([])
  const [pausedAgentRun, setPausedAgentRun] = useState<AgentRun | null>(null)
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([])
  const [auditLogsLoading, setAuditLogsLoading] = useState(false)
  const [memoryNotes, setMemoryNotes] = useState<MemoryNote[]>(() =>
    readJsonFromStorage<string[]>('ai-butler:memoryNotes', []).map((text, index) => ({
      id: `legacy-memory-${index}`,
      text,
      category: 'context',
      pinned: false,
      createdAt: Date.now() - index,
      updatedAt: Date.now() - index,
    })),
  )
  const [builtinSkillOverrides, setBuiltinSkillOverrides] = useState<BuiltinOverrideMap>(() =>
    readJsonFromStorage('ai-butler:builtinSkillOverrides', {}),
  )
  const [builtinToolOverrides, setBuiltinToolOverrides] = useState<BuiltinOverrideMap>(() =>
    readJsonFromStorage('ai-butler:builtinToolOverrides', {}),
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsPage, setSettingsPage] = useState<SettingsPage>('home')
  const [workspacePage, setWorkspacePage] = useState<WorkspacePage>('home')
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => Number(localStorage.getItem('ai-butler:leftPanelWidth')) || 280)
  const [rightPanelWidth, setRightPanelWidth] = useState(() => Number(localStorage.getItem('ai-butler:rightPanelWidth')) || 340)
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(() => localStorage.getItem('ai-butler:leftPanelCollapsed') === 'true')
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(() => localStorage.getItem('ai-butler:rightPanelCollapsed') === 'true')
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null)
  const [editingToolId, setEditingToolId] = useState<string | null>(null)
  const [pendingFileReadStep, setPendingFileReadStep] = useState<PendingFileReadStep>(() =>
    readJsonFromStorage('ai-butler:pendingFileReadStep', null),
  )
  const [pendingTripStep, setPendingTripStep] = useState<PendingTripStep>(() =>
    readJsonFromStorage('ai-butler:pendingTripStep', null),
  )
  const [tripDraft, setTripDraft] = useState<TripDraft>(() =>
    readJsonFromStorage('ai-butler:tripDraft', {}),
  )
  const [tripPlannerOpen, setTripPlannerOpen] = useState(false)
  const [tripResultCard, setTripResultCard] = useState<TripResultCard | null>(null)
  const [pendingReportCard, setPendingReportCard] = useState<PendingReportCard | null>(null)
  const [voiceEnabled, setVoiceEnabled] = useState(() => localStorage.getItem('ai-butler:voiceEnabled') === 'true')
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [platformConfig, setPlatformConfig] = useState<AgentPlatformConfig | null>(null)
  const [ragStatus, setRagStatus] = useState('')
  const [workflowData, setWorkflowData] = useState<ButlerWorkspaceData>({
    reports: [],
    plans: [],
    activities: [],
  })
  const [extensionsPath, setExtensionsPath] = useState('')
  const [planForm, setPlanForm] = useState({
    title: '',
    description: '',
    priority: 'medium' as ButlerPlan['priority'],
    dueDate: '',
    recurrence: 'none' as ButlerPlan['recurrence'],
  })
  const [progressDraft, setProgressDraft] = useState({
    planId: '',
    note: '',
    completion: '50',
    blocker: '',
  })
  const [activityNote, setActivityNote] = useState('')
  const [memoryForm, setMemoryForm] = useState({
    text: '',
    category: 'context' as MemoryNote['category'],
    expiresOn: '',
  })
  const [providerForm, setProviderForm] = useState({
    name: '',
    type: 'openai-compatible' as ProviderType,
    model: '',
    baseUrl: '',
    apiKey: '',
  })
  const [customSkillForm, setCustomSkillForm] = useState({
    name: '',
    description: '',
    prompt: '',
  })
  const [customToolForm, setCustomToolForm] = useState({
    name: '',
    description: '',
    endpoint: '',
    method: 'POST' as 'GET' | 'POST',
    apiKey: '',
    apiKeyPlacement: 'bearer' as 'none' | 'bearer' | 'query' | 'header',
    apiKeyName: '',
    timeoutMs: 20000,
    retries: 0,
    version: '1.0.0',
    headersJson: '',
    inputSchemaJson: '',
    queryParamsJson: '',
    bodyParamsJson: '',
    responsePath: '',
  })
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      role: 'assistant',
      content:
        '你好，我是桌面 AI 管家。你可以把文件、行程、计划或目标交给我，我会把它们整理成报告、今日任务、提醒和后续跟踪；切换到开发者模式后，还可以配置模型、Skill 和 HTTP API Tool。',
      createdAt: Date.now(),
    },
  ])

  const isThinking = assistantStatus === 'thinking'
  const activeProvider = platformConfig?.providers.find(
    (provider) => provider.id === platformConfig.activeProviderId,
  )
  const activePlans = workflowData.plans.filter((plan) => plan.status === 'active')
  const finishedPlans = workflowData.plans.filter((plan) => plan.status === 'done')
  const stalePlans = activePlans.filter(isPlanStale)
  const todayPlans = activePlans.filter(
    (plan) => !isSameDay(plan.lastCheckinAt) || Boolean(plan.reminderTime) || isPlanStale(plan),
  )
  const latestReport = workflowData.reports[0]
  const builtinSkillViews = skillRegistry
    .map((skill) => ({
      ...skill,
      displayName: builtinSkillOverrides[skill.id]?.name ?? skill.name,
      displayDescription: builtinSkillOverrides[skill.id]?.description ?? skill.description,
      enabled: builtinSkillOverrides[skill.id]?.enabled !== false,
      deleted: builtinSkillOverrides[skill.id]?.deleted === true,
    }))
    .filter((skill) => !skill.deleted)
  const builtinToolViews = toolRegistry
    .map((tool) => ({
      ...tool,
      displayName: builtinToolOverrides[tool.name]?.name ?? tool.label,
      displayDescription: builtinToolOverrides[tool.name]?.description ?? tool.description,
      enabled: builtinToolOverrides[tool.name]?.enabled !== false,
      deleted: builtinToolOverrides[tool.name]?.deleted === true,
    }))
    .filter((tool) => !tool.deleted)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const agentAbortControllerRef = useRef<AbortController | null>(null)
  const agentPauseRequestedRef = useRef(false)
  const hasSyncedKnowledgeRef = useRef(false)
  const hasSyncedMemoryRef = useRef(false)

  function addToolLog(log: ToolCallLog) {
    setToolLogs((currentLogs) => [log, ...currentLogs].slice(0, 8))
  }

  function addTimelineStep(step: AgentTimelineStep) {
    setAgentTimeline((currentSteps) => [step, ...currentSteps].slice(0, 12))
  }

  function requestToolPermission(toolName: string, reason: string) {
    return window.confirm(`桌面 AI 管家请求调用工具：${toolName}\n\n原因：${reason}\n\n是否允许？`)
  }

  function createRegistryInventoryReply(kind: RegistryInventoryKind) {
    if (kind === 'skill') {
      const builtinLines = builtinSkillViews.map(
        (skill, index) =>
          `${index + 1}. ${skill.displayName}（${skill.enabled ? '已启用' : '已禁用'}）\n   ${skill.displayDescription}\n   所需 Tool：${skill.requiredTools.join('、') || '无'}`,
      )
      const customSkills = platformConfig?.customSkills ?? []
      const customLines = customSkills.map(
        (skill, index) =>
          `${index + 1}. ${skill.name}（${skill.enabled === false ? '已禁用' : '已启用'}${skill.source === 'extension' ? '，扩展目录' : ''}）\n   ${skill.description}`,
      )
      return `我当前实际注册了 ${builtinLines.length + customLines.length} 个 Skill。\n\n内置 Skill：\n${builtinLines.join('\n') || '无'}\n\n自定义 Skill：\n${customLines.join('\n') || '暂无'}\n\n这些是系统真实注册项，不是模型泛泛描述的能力。`
    }

    const builtinLines = builtinToolViews.map(
      (tool, index) =>
        `${index + 1}. ${tool.displayName} / ${tool.name}（${tool.enabled ? '已启用' : '已禁用'}，风险：${tool.riskLevel}）\n   ${tool.displayDescription}`,
    )
    const customTools = platformConfig?.customTools ?? []
    const customLines = customTools.map(
      (tool, index) =>
        `${index + 1}. ${tool.name}（${tool.enabled === false ? '已禁用' : '已启用'}，${tool.method}${tool.source === 'extension' ? '，扩展目录' : ''}）\n   ${tool.description}`,
    )
    return `我当前实际注册了 ${builtinLines.length + customLines.length} 个 Tool。\n\n内置 Tool：\n${builtinLines.join('\n') || '无'}\n\n自定义 HTTP Tool：\n${customLines.join('\n') || '暂无'}。`
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (window.electronAPI) {
        setIsElectronReady(true)
        setAppName(window.electronAPI.getAppName())
        window.clearInterval(timer)
      }
    }, 300)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!isElectronReady) {
      return
    }

    window.electronAPI.getAppVersion().then(setAppVersion)
    window.electronAPI.getSystemInfo().then((systemInfo) => {
      setSystemInfoText(`${systemInfo.platform} / ${systemInfo.arch} / ${systemInfo.cpus} 核`)
    })
    window.electronAPI.getPlatformConfig().then(setPlatformConfig)
    window.electronAPI.getExtensionsPath().then(setExtensionsPath)
    window.electronAPI.getWorkflowData().then(setWorkflowData)
    window.electronAPI.getKnowledgeDocuments().then(setKnowledgeIndex)
    window.electronAPI.getAgentRuns().then(async (runs) => {
      const restoredRuns = [...runs]
      const resumableRun = restoredRuns.find((run) => run.status === 'paused' || run.status === 'running')

      if (resumableRun) {
        const restoredRun: AgentRun = {
          ...resumableRun,
          status: 'paused',
          observations: resumableRun.observations as AgentRun['observations'],
          pauseReason: resumableRun.status === 'running' ? '应用上次退出时任务仍在运行' : '用户暂停任务',
        }
        setPausedAgentRun(restoredRun)

        if (resumableRun.status === 'running') {
          const savedRun = await window.electronAPI.saveAgentRun(restoredRun)
          const index = restoredRuns.findIndex((run) => run.id === savedRun.id)
          if (index >= 0) restoredRuns[index] = savedRun
        }
      }

      setAgentRuns(restoredRuns)
    })
    window.electronAPI.getAuditLogs({ limit: 100 }).then(setAuditLogs)
    window.electronAPI.getMemoryNotes().then(async (storedNotes) => {
      const legacyNotes = readJsonFromStorage<string[]>('ai-butler:memoryNotes', [])
      const nextNotes = legacyNotes.length > 0
        ? await window.electronAPI.syncMemoryNotes(legacyNotes)
        : storedNotes
      setMemoryNotes(nextNotes)
      hasSyncedMemoryRef.current = true
      localStorage.removeItem('ai-butler:memoryNotes')
    })
  }, [isElectronReady])

  useEffect(() => {
    if (!isElectronReady || hasSyncedKnowledgeRef.current || knowledgeDocuments.length === 0) return
    hasSyncedKnowledgeRef.current = true
    window.electronAPI
      .syncKnowledgeDocuments(knowledgeDocuments)
      .then(() => window.electronAPI.getKnowledgeDocuments())
      .then((documents) => {
        setKnowledgeIndex(documents)
        localStorage.removeItem('ai-butler:knowledgeDocuments')
      })
      .catch(() => {
        hasSyncedKnowledgeRef.current = false
      })
  }, [isElectronReady, knowledgeDocuments])

  useEffect(() => {
    if (!isThinking) {
      inputRef.current?.focus()
    }
  }, [isThinking])

  useEffect(() => {
    if (isElectronReady) return
    localStorage.setItem('ai-butler:knowledgeDocuments', JSON.stringify(knowledgeDocuments))
  }, [isElectronReady, knowledgeDocuments])

  useEffect(() => {
    if (isElectronReady && hasSyncedMemoryRef.current) return
    localStorage.setItem('ai-butler:memoryNotes', JSON.stringify(memoryNotes.map((note) => note.text)))
  }, [isElectronReady, memoryNotes])

  useEffect(() => {
    localStorage.setItem('ai-butler:builtinSkillOverrides', JSON.stringify(builtinSkillOverrides))
  }, [builtinSkillOverrides])

  useEffect(() => {
    localStorage.setItem('ai-butler:builtinToolOverrides', JSON.stringify(builtinToolOverrides))
  }, [builtinToolOverrides])

  useEffect(() => {
    localStorage.setItem('ai-butler:pendingFileReadStep', JSON.stringify(pendingFileReadStep))
  }, [pendingFileReadStep])

  useEffect(() => {
    localStorage.setItem('ai-butler:pendingTripStep', JSON.stringify(pendingTripStep))
  }, [pendingTripStep])

  useEffect(() => {
    localStorage.setItem('ai-butler:tripDraft', JSON.stringify(tripDraft))
  }, [tripDraft])

  useEffect(() => {
    localStorage.setItem('ai-butler:voiceEnabled', String(voiceEnabled))
  }, [voiceEnabled])

  useEffect(() => {
    localStorage.setItem('ai-butler:leftPanelWidth', String(leftPanelWidth))
  }, [leftPanelWidth])

  useEffect(() => {
    localStorage.setItem('ai-butler:rightPanelWidth', String(rightPanelWidth))
  }, [rightPanelWidth])

  useEffect(() => {
    localStorage.setItem('ai-butler:leftPanelCollapsed', String(leftPanelCollapsed))
  }, [leftPanelCollapsed])

  useEffect(() => {
    localStorage.setItem('ai-butler:rightPanelCollapsed', String(rightPanelCollapsed))
  }, [rightPanelCollapsed])

  useEffect(() => {
    if (!isElectronReady) {
      return
    }

    const checkReminders = async () => {
      const now = new Date()
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      const todayKey = getDateKey(now)
      const duePlan = workflowData.plans.find(
        (plan) => {
          if (plan.status !== 'active') return false
          const anchorDate = plan.dueDate ? new Date(`${plan.dueDate}T00:00:00`) : new Date(plan.createdAt)
          const recurrenceMatches =
            plan.recurrence === 'daily' ||
            (plan.recurrence === 'weekly' && anchorDate.getDay() === now.getDay()) ||
            (plan.recurrence === 'none' && !plan.lastReminderDate)
          const scheduledReminder = Boolean(
            plan.reminderTime && plan.reminderTime <= currentTime && recurrenceMatches,
          )
          const deadlineReminder = Boolean(plan.dueDate && plan.dueDate <= todayKey)
          return (scheduledReminder || deadlineReminder) && plan.lastReminderDate !== todayKey
        },
      )

      if (!duePlan) {
        return
      }

      const isOverdue = Boolean(duePlan.dueDate && duePlan.dueDate < todayKey)
      await window.electronAPI.notify(
        isOverdue ? '计划已逾期' : '桌面 AI 管家提醒',
        `${isOverdue ? '请重新安排或推进' : '该推进计划了'}：${duePlan.title}`,
      )
      const nextData = await window.electronAPI.updatePlan(duePlan.id, {
        lastReminderDate: todayKey,
      })
      setWorkflowData(nextData)
    }

    checkReminders()
    const timer = window.setInterval(checkReminders, 60_000)
    return () => window.clearInterval(timer)
  }, [isElectronReady, workflowData.plans])

  function speak(text: string) {
    if (!voiceEnabled || !('speechSynthesis' in window)) {
      return
    }

    window.speechSynthesis.cancel()
    const spokenText = text
      .replace(/```[\s\S]*?```/g, '代码块已省略。')
      .replace(/[*#>`_()[\]~-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const utterance = new SpeechSynthesisUtterance(spokenText.slice(0, 600))
    utterance.lang = 'zh-CN'
    utterance.rate = 1.02
    utterance.voice = window.speechSynthesis.getVoices().find((voice) =>
      voice.lang.toLowerCase().startsWith('zh'),
    ) ?? null
    window.speechSynthesis.speak(utterance)
  }

  async function streamAssistantMessage(content: string) {
    const messageId = createMessageId()
    const assistantMessage: Message = {
      id: messageId,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    }

    setMessages((currentMessages) => [...currentMessages, assistantMessage])

    const chunkSize = content.length > 800 ? 8 : 4
    for (let index = 0; index < content.length; index += chunkSize) {
      const nextContent = content.slice(0, index + chunkSize)
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === messageId ? { ...message, content: nextContent } : message,
        ),
      )
      await new Promise((resolve) => window.setTimeout(resolve, 18))
    }

    speak(content)
  }

  async function saveGeneratedReport(
    content: string,
    source: string,
    createPlans = false,
  ): Promise<SavedReportResult | null> {
    if (!isElectronReady) {
      return null
    }

    const title = source.includes('文件夹') ? '资料夹分析报告' : `${source} 分析报告`
    const nextData = await window.electronAPI.saveReport({
      title,
      summary: createReportSummary(content),
      content,
      source,
    })
    setWorkflowData(nextData)
    const savedReport = nextData.reports[0]
    const createdPlans: ButlerPlan[] = []

    const planDrafts = createPlans ? extractPlanDraftsFromReport(content) : []
    if (planDrafts.length > 0) {
      let currentData = nextData
      for (const draft of planDrafts.slice(0, 3)) {
        currentData = await window.electronAPI.savePlan(draft)
        if (currentData.plans[0]) {
          createdPlans.push(currentData.plans[0])
        }
      }
      setWorkflowData(currentData)
    }

    return savedReport
      ? {
          report: savedReport,
          createdPlans,
        }
      : null
  }

  function queueGeneratedReport(content: string, source: string) {
    setPendingReportCard({
      title: source.includes('文件夹') ? '资料夹分析报告' : `${source} 分析报告`,
      summary: createReportSummary(content),
      content,
      source,
      planCount: Math.min(extractPlanDraftsFromReport(content).length, 3),
    })
  }

  async function confirmGeneratedReport(createPlans: boolean) {
    if (!pendingReportCard) return
    const card = pendingReportCard
    const savedResult = await saveGeneratedReport(card.content, card.source, createPlans)
    setPendingReportCard(null)
    await streamAssistantMessage(createWorkflowDoneMessage(savedResult))
  }

  async function downloadGeneratedReport() {
    if (!pendingReportCard) return
    await window.electronAPI.exportTripCard({
      title: pendingReportCard.title,
      content: pendingReportCard.content,
    })
  }

  function getUnavailableModelMessage(files: LocalTextFile[]) {
    const workbookNames = files.flatMap((file) =>
      Array.from(file.content.matchAll(/^# 工作表：(.+)$/gm), (match) => match[1]),
    )
    const workbookLine =
      workbookNames.length > 0 ? `\n已识别工作表：${workbookNames.join('、')}。` : ''

    return `文件已成功读取：${files.map((file) => file.name).join('、')}。${workbookLine}

当前使用的是本地演示模型，它不具备真实的数据分析能力，因此我不会把原始文件内容伪装成分析报告。

请在“设置 → 模型 Provider”中选择并配置一个可用模型，然后重新发送这些文件。`
  }

  function hasUsableModelProvider() {
    return Boolean(activeProvider && activeProvider.type !== 'mock' && activeProvider.apiKey?.trim())
  }

  function createWorkflowDoneMessage(result: SavedReportResult | null) {
    if (!result) {
      return '分析完成，但当前不是 Electron 桌面环境，报告和计划没有保存。'
    }

    const planLines =
      result.createdPlans.length > 0
        ? result.createdPlans.map((plan, index) => `${index + 1}. ${plan.title}`).join('\n')
        : '这次没有自动提取到明确计划，你可以在右侧手动添加。'

    return `管家工作流已完成：

1. 已保存报告
报告名称：${result.report.title}
位置：右侧「桌面行动卡」模块

2. 已提取计划
${planLines}

3. 下一步你可以做
- 点右侧「固定到桌面边缘」，把报告变成可侧边收起的桌面行动卡
- 在「计划打卡」里对计划打卡、完成或删除
- 在「行动记录」里记录你今天做了什么，后续我可以根据记录调整计划`
  }

  async function generateReportFromConversation() {
    if (isThinking || !isElectronReady) {
      return
    }

    setAssistantStatus('thinking')
    try {
      const recentContext = messages
        .slice(-8)
        .map((message) => `${message.role === 'user' ? '用户' : '管家'}：${message.content}`)
        .join('\n\n')
      const reply = await createAssistantReply(
        `请根据最近对话和资料，生成一份可保存的桌面管家报告。结构必须包含：
1. 报告摘要
2. 关键发现
3. 风险或问题
4. 下一步计划
5. 待办清单

最近上下文：
${recentContext}`,
      )
      await streamAssistantMessage(reply.content)
      queueGeneratedReport(reply.content, '最近对话')
    } catch {
      await streamAssistantMessage('生成报告失败。请检查模型配置或网络。')
    } finally {
      setAssistantStatus('idle')
    }
  }

  async function addPlanFromForm() {
    if (!isElectronReady || !planForm.title.trim()) {
      return
    }

    const nextData = await window.electronAPI.savePlan({
      title: planForm.title.trim(),
      description: planForm.description.trim() || planForm.title.trim(),
      priority: planForm.priority,
      dueDate: planForm.dueDate || undefined,
      recurrence: planForm.recurrence,
      progress: 0,
    })
    setWorkflowData(nextData)
    setPlanForm({ title: '', description: '', priority: 'medium', dueDate: '', recurrence: 'none' })
  }

  async function updatePlanReminder(plan: ButlerPlan, reminderTime: string) {
    if (!isElectronReady) {
      return
    }

    const nextData = await window.electronAPI.updatePlan(plan.id, {
      reminderTime: reminderTime || undefined,
      lastReminderDate: undefined,
    })
    setWorkflowData(nextData)
  }

  async function updatePlanDetails(plan: ButlerPlan, patch: Partial<ButlerPlan>) {
    if (!isElectronReady) return
    setWorkflowData(await window.electronAPI.updatePlan(plan.id, patch))
  }

  async function splitStalePlan(plan: ButlerPlan) {
    if (!isElectronReady || isThinking) {
      return
    }

    setAssistantStatus('thinking')
    try {
      const reply = await createAssistantReply(
        `用户的计划已经至少 2 天没有推进。请把这个计划拆成 3 个更小、更容易执行的子任务，并给出明天优先做什么。

计划标题：${plan.title}
计划说明：${plan.description}
上次记录时间：${plan.lastCheckinAt ? new Date(plan.lastCheckinAt).toLocaleString('zh-CN') : '从未记录'}

输出要求：
1. 为什么可能卡住
2. 拆成 3 个小任务
3. 明天先做哪一个
4. 是否建议修改原计划`,
      )
      await streamAssistantMessage(`停滞检测：${plan.title}\n\n${reply.content}`)
      const nextData = await window.electronAPI.addActivity(`停滞检测：已为「${plan.title}」生成拆解建议`)
      setWorkflowData(nextData)
    } catch {
      await streamAssistantMessage('拆解计划失败了。请检查模型配置或稍后再试。')
    } finally {
      setAssistantStatus('idle')
    }
  }

  function startProgressRecord(plan: ButlerPlan) {
    setProgressDraft({
      planId: plan.id,
      note: '',
      completion: '50',
      blocker: '',
    })
  }

  async function submitPlanProgress(plan: ButlerPlan) {
    if (!isElectronReady || !progressDraft.note.trim()) {
      return
    }

    const progressText = `计划：${plan.title}
计划说明：${plan.description}
今日完成度：${progressDraft.completion}%
今天做了什么：${progressDraft.note}
遇到的问题：${progressDraft.blocker || '无'}`

    try {
      setAssistantStatus('thinking')
      const review = await createAssistantReply(
        `你是桌面 AI 管家的计划复盘助手。请根据用户今天的进度记录，判断：
1. 今天推进得怎么样
2. 这个计划还剩什么关键事项
3. 后续计划是否需要修改，如果需要，请给出修改建议
4. 明天最应该做的 1-3 个动作

要求：简洁、具体、可执行。

${progressText}`,
      )
      const nextData = await window.electronAPI.checkinPlan(
        plan.id,
        `${progressDraft.completion}%｜${progressDraft.note}${progressDraft.blocker ? `｜问题：${progressDraft.blocker}` : ''}`,
        Number(progressDraft.completion),
      )
      setWorkflowData(nextData)
      setProgressDraft({ planId: '', note: '', completion: '50', blocker: '' })
      await streamAssistantMessage(`已记录进度：${plan.title}\n\n${review.content}`)
    } catch {
      await streamAssistantMessage('记录进度失败了。请检查模型配置或稍后再试一次。')
    } finally {
      setAssistantStatus('idle')
    }
  }

  async function togglePlanDone(plan: ButlerPlan) {
    if (!isElectronReady) {
      return
    }

    const nextStatus = plan.status === 'done' ? 'active' : 'done'
    try {
      const nextData = await window.electronAPI.updatePlan(plan.id, {
        status: nextStatus,
      })
      setWorkflowData(nextData)
      await streamAssistantMessage(
        nextStatus === 'done'
          ? `已完成计划：${plan.title}`
          : `已把计划恢复为进行中：${plan.title}`,
      )
    } catch {
      await streamAssistantMessage('修改计划状态失败了。请稍后再试一次。')
    }
  }

  async function deletePlan(planId: string) {
    const targetPlan = workflowData.plans.find((plan) => plan.id === planId)
    if (!isElectronReady || !window.confirm(`确定删除这个计划吗？\n\n${targetPlan?.title ?? ''}`)) {
      return
    }

    try {
      const nextData = await window.electronAPI.deletePlan(planId)
      setWorkflowData(nextData)
      await streamAssistantMessage(`已删除计划：${targetPlan?.title ?? planId}`)
    } catch {
      await streamAssistantMessage('删除计划失败了。请稍后再试一次。')
    }
  }

  async function addActivityNote() {
    if (!isElectronReady || !activityNote.trim()) {
      return
    }

    const nextData = await window.electronAPI.addActivity(activityNote.trim())
    setWorkflowData(nextData)
    setActivityNote('')
  }

  async function openFloatingReport(reportId: string) {
    if (!isElectronReady) {
      return
    }

    await window.electronAPI.openFloatingReport(reportId)
  }

  async function openFloatingPlan(planId: string) {
    if (!isElectronReady) return
    await window.electronAPI.openFloatingPlan(planId)
  }

  async function deleteReport(report: ButlerReport) {
    if (!isElectronReady || !window.confirm(`确定删除报告“${report.title}”？`)) return
    setWorkflowData(await window.electronAPI.deleteReport(report.id))
  }

  async function deleteActivity(activity: ButlerActivity) {
    if (!isElectronReady || !window.confirm('确定删除这条行动记录？')) return
    setWorkflowData(await window.electronAPI.deleteActivity(activity.id))
  }

  async function invokeOptionalTripTool(tool: CustomToolConfig | undefined, input: string) {
    if (!tool) {
      return '未配置对应 API Tool。'
    }

    try {
      const result = await window.electronAPI.invokeCustomTool(tool.id, input)
      if (/"status"\s*:\s*"?0|ENGINE_RESPONSE_DATA_ERROR|INVALID_USER_KEY|"infocode"\s*:\s*"?3\d+/i.test(result.content)) {
        throw new Error('Tool 返回业务错误')
      }
      addToolLog({
        id: createMessageId(),
        name: `trip:${tool.name}`,
        status: 'success',
        detail: result.content.slice(0, 120),
        createdAt: Date.now(),
      })
      return result.content.slice(0, 3000)
    } catch {
      addToolLog({
        id: createMessageId(),
        name: `trip:${tool.name}`,
        status: 'error',
        detail: '出差规划调用失败',
        createdAt: Date.now(),
      })
      return `已找到 Tool「${tool.name}」，但调用失败。请检查 Endpoint、参数占位符或 API Key。`
    }
  }

  async function runTripPlanner(draft: TripDraft) {
    draft = { ...draft, dateText: normalizeTripDate(draft.dateText) }
    const enabledTools = platformConfig?.customTools.filter((tool) => tool.enabled !== false) ?? []
    const hotelTool = findTripTool(enabledTools, 'hotel')
    const tripInput = `从${draft.origin}去${draft.destination}，时间${draft.dateText}，住${draft.nights}晚，目的：${draft.purpose ?? '普通出差'}`

    addTimelineStep({
      id: createMessageId(),
      title: '出差规划',
      detail: tripInput,
      status: 'success',
      createdAt: Date.now(),
    })

    const [amapResult, hotelResult] = await Promise.all([
      window.electronAPI.planTripWithAmap({ origin: draft.origin!, destination: draft.destination!, dateText: draft.dateText! }),
      invokeOptionalTripTool(hotelTool, `${draft.destination} ${draft.dateText} 住宿 ${draft.nights}晚 酒店 预算`),
    ])
    const weatherResult = amapResult.weather
      ? `${amapResult.weather.date}：白天${amapResult.weather.dayWeather} ${amapResult.weather.dayTemp}℃，夜间${amapResult.weather.nightWeather} ${amapResult.weather.nightTemp}℃，${amapResult.weather.dayWind}风`
      : '暂无天气数据'
    const transportResult = amapResult.route
      ? `驾车距离 ${(amapResult.route.distanceMeters / 1000).toFixed(1)} 公里，预计 ${(amapResult.route.durationSeconds / 3600).toFixed(1)} 小时，过路费约 ${amapResult.route.tolls} 元。高铁和机票价格需另外接入票务 API。`
      : '暂无路线数据'
    const safeHotelResult = hotelResult.startsWith('未配置') || hotelResult.includes('调用失败') || /"status"\s*:\s*"?0/.test(hotelResult)
      ? '暂无实时酒店价格，请按公司住宿标准筛选。'
      : hotelResult

    const historyContext = workflowData.reports
      .filter((report) => /出差|差旅|报销|交通|酒店/.test(report.content))
      .slice(0, 3)
      .map((report) => `# ${report.title}\n${report.content.slice(0, 1200)}`)
      .join('\n\n') || '暂无历史出差报告。'

    const reply = await createAssistantReply(
      `你是桌面 AI 管家的出差建议助手。路线和天气已经由程序验证成功，你只负责生成简短行动建议，不得评价 API 是否可用。

用户需求：
${tripInput}

天气 API 结果：
${weatherResult}

交通 API 结果：
${transportResult}

酒店 API 结果：
${safeHotelResult}

历史出差记录：
${historyContext}

请控制在 300 字以内。禁止出现“API 错误、API 数据问题、无法确定交通天气、建议配置 Tool”等表述，禁止重复上面的路线和天气数据。固定结构：
## 行前待办
最多 5 条，每条以动词开头。
## 报销材料
最多 4 条。不要写空泛建议，不要重复。`,
    )

    const factualSummary = `## 行程概览

- **路线**：${transportResult}
- **天气**：${weatherResult}
- **住宿**：${safeHotelResult}

${sanitizeTripAdvice(reply.content)}`
    await streamAssistantMessage(factualSummary)
    const facts = [transportResult, weatherResult]
    facts.push(`住宿：${safeHotelResult}`)
    setTripResultCard({
      title: `${draft.destination}出差行动卡`,
      subtitle: `${draft.dateText} · ${draft.origin} → ${draft.destination} · ${draft.nights} 晚`,
      facts,
      content: factualSummary,
      draft,
    })
    setTripDraft({})
    setPendingTripStep(null)
  }

  async function saveTripCardToPlan() {
    if (!tripResultCard || !isElectronReady) return
    const nextData = await window.electronAPI.savePlan({
      title: tripResultCard.title,
      description: `${tripResultCard.subtitle}\n${tripResultCard.facts.join('\n')}`,
      priority: 'high', dueDate: tripResultCard.draft.dateText, nextAction: '确认交通与住宿预订',
    })
    setWorkflowData(nextData)
    setTripResultCard({ ...tripResultCard, savedToPlan: true })
  }

  async function downloadTripCard() {
    if (!tripResultCard || !isElectronReady) return
    await window.electronAPI.exportTripCard({
      title: tripResultCard.title,
      content: `${tripResultCard.subtitle}\n\n${tripResultCard.facts.map((fact) => `- ${fact}`).join('\n')}\n\n${tripResultCard.content}`,
    })
  }

  async function submitTripPlannerForm() {
    const missingFields = getMissingTripFields(tripDraft)
    if (missingFields.length > 0 || isThinking) return
    const requestText = `从${tripDraft.origin}去${tripDraft.destination}，${tripDraft.dateText}出发，住${tripDraft.nights}晚，目的：${tripDraft.purpose?.trim() || '普通出差'}`
    setTripPlannerOpen(false)
    setMessages((currentMessages) => [...currentMessages, {
      id: createMessageId(), role: 'user', content: requestText, createdAt: Date.now(),
    }])
    setAssistantStatus('thinking')
    try {
      await runTripPlanner(tripDraft)
    } catch {
      await streamAssistantMessage('出差规划暂时没有完成。请检查模型服务和高德 Tool 配置后重试。')
    } finally {
      setAssistantStatus('idle')
    }
  }

  async function handleTripPlanning(text: string) {
    const nextDraft = mergeTripDraft(tripDraft, extractTripDraft(text))
    const missingFields = getMissingTripFields(nextDraft)

    if (missingFields.length > 0) {
      setTripDraft(nextDraft)
      setPendingTripStep('awaitingDetails')
      await streamAssistantMessage(
        `可以，我来做出差规划。还差这些信息：${missingFields.join('、')}。

你可以这样回复：
从北京出发，下周三去上海，住 1 晚，目的：客户拜访`,
      )
      return
    }

    await runTripPlanner(nextDraft)
  }

  async function persistAgentRun(run: AgentRun) {
    const savedRun = await window.electronAPI.saveAgentRun(run)
    setAgentRuns((currentRuns) => [
      savedRun,
      ...currentRuns.filter((item) => item.id !== savedRun.id),
    ])
    if (run.status === 'paused') {
      setPausedAgentRun(run)
    } else if (run.status !== 'running' && pausedAgentRun?.id === run.id) {
      setPausedAgentRun(null)
    }
  }

  async function executeAgentRequest(text: string, resumeFrom?: AgentRun) {
    const enabledCustomTools = platformConfig?.customTools.filter((tool) => tool.enabled !== false) ?? []
    const modeHint = '请优先用通俗表达帮助用户整理资料、分析文件、生成报告和可执行计划。'
    const memoryContext = memoryNotes.length > 0
      ? `\n\n用户长期记忆：\n${memoryNotes.map((note) => note.text).join('\n')}`
      : ''
    let streamedMessageId: number | null = null
    let streamedContent = ''
    const controller = new AbortController()
    agentAbortControllerRef.current = controller
    agentPauseRequestedRef.current = false
    if (!resumeFrom) setPausedAgentRun(null)

    const assistantReply = await runAgent(text, addToolLog, {
      knowledgeDocuments,
      builtinTools: builtinToolViews
        .filter((tool) => tool.enabled)
        .map(({ displayName, displayDescription, enabled: _enabled, deleted: _deleted, ...tool }) => ({
          ...tool,
          label: displayName,
          description: displayDescription,
        })),
      customTools: enabledCustomTools,
      context: `${modeHint}${memoryContext}`,
      onTimeline: addTimelineStep,
      requestPermission: requestToolPermission,
      onRunUpdate: persistAgentRun,
      onRunComplete: persistAgentRun,
      signal: controller.signal,
      shouldPause: () => agentPauseRequestedRef.current,
      resumeFrom,
      onAssistantDelta: (delta) => {
        streamedContent += delta
        if (streamedMessageId === null) {
          streamedMessageId = createMessageId()
          setMessages((currentMessages) => [
            ...currentMessages,
            { id: streamedMessageId!, role: 'assistant', content: streamedContent, createdAt: Date.now() },
          ])
          return
        }

        const targetMessageId = streamedMessageId
        setMessages((currentMessages) => currentMessages.map((message) =>
          message.id === targetMessageId ? { ...message, content: streamedContent } : message,
        ))
      },
    })

    if (streamedMessageId === null) {
      await streamAssistantMessage(assistantReply.content)
    } else {
      const targetMessageId = streamedMessageId
      setMessages((currentMessages) => currentMessages.map((message) =>
        message.id === targetMessageId ? { ...message, content: assistantReply.content } : message,
      ))
      speak(assistantReply.content)
    }
    agentAbortControllerRef.current = null
  }

  function pauseAgentRun() {
    agentPauseRequestedRef.current = true
  }

  function cancelAgentRun() {
    agentAbortControllerRef.current?.abort()
  }

  async function resumeAgentRun() {
    if (!pausedAgentRun || isThinking) return
    setAssistantStatus('thinking')
    setAgentTimeline([])
    try {
      await executeAgentRequest(pausedAgentRun.goal, pausedAgentRun)
    } catch {
      await streamAssistantMessage('任务恢复失败，请在运行记录中查看错误后重试。')
    } finally {
      agentAbortControllerRef.current = null
      setAssistantStatus('idle')
    }
  }

  async function sendMessage() {
    if (isThinking) {
      return
    }

    const text = input.trim()
    if (!text && pendingAttachments.length === 0) {
      return
    }

    if (pendingAttachments.length > 0) {
      const files = pendingAttachments
      setInput('')
      setPendingAttachments([])
      await analyzePendingAttachments(text, files)
      return
    }

    const userMessage: Message = {
      id: createMessageId(),
      role: 'user',
      content: text,
      createdAt: Date.now(),
    }

    setMessages((currentMessages) => [...currentMessages, userMessage])
    setInput('')
    setAssistantStatus('thinking')
    setAgentTimeline([])

    try {
      const inventoryKind = getRegistryInventoryKind(text)
      if (inventoryKind) {
        addTimelineStep({
          id: createMessageId(),
          title: '读取注册表',
          detail: inventoryKind === 'skill' ? 'Skill Registry' : 'Tool Registry',
          status: 'success',
          createdAt: Date.now(),
        })
        await streamAssistantMessage(createRegistryInventoryReply(inventoryKind))
        return
      }

      if (!isElectronReady) {
        const browserMessage: Message = {
          id: createMessageId(),
          role: 'assistant',
          content:
            '当前是浏览器预览模式，只能查看界面。请使用 npm run dev:electron 启动桌面版，才能读取文件、调用工具和访问主进程 AI 服务。',
          createdAt: Date.now(),
        }
        setMessages((currentMessages) => [...currentMessages, browserMessage])
        return
      }

      if (pendingTripStep === 'awaitingDetails') {
        await handleTripPlanning(text)
        return
      }

      if (isTripPlanningRequest(text)) {
        await handleTripPlanning(text)
        return
      }

      if (pendingFileReadStep === 'awaitingConsent') {
        if (isNegativeReply(text)) {
          setPendingFileReadStep(null)
          await streamAssistantMessage('好的，我不会读取你的本地文件。')
          return
        }

        if (isPositiveReply(text)) {
          setPendingFileReadStep('awaitingScope')
          await streamAssistantMessage('好的。你想让我读取全部文件，还是只读取单独一个文件？\n\n你可以回复“全部文件”或“单独文件”。')
          return
        }

        await streamAssistantMessage('我需要你明确确认一下：是否允许我读取本地文件？你可以回复“确认”或“取消”。')
        return
      }

      if (pendingFileReadStep === 'awaitingScope') {
        setPendingFileReadStep(null)

        if (isAllFilesScope(text)) {
          await streamAssistantMessage('可以。我会让你选择一个文件夹，然后读取其中可分析的文本文件。')
          await analyzeDirectoryFiles()
          return
        }

        if (isSingleFileScope(text) || isPositiveReply(text)) {
          await streamAssistantMessage('可以。我会打开文件选择器，你选择一个文件后我再分析。')
          await summarizeTextFile()
          return
        }

        await streamAssistantMessage('我还没判断出你要读取全部文件还是单独文件。请回复“全部文件”或“单独文件”。')
        setPendingFileReadStep('awaitingScope')
        return
      }

      if (isFileReadRequest(text)) {
        if (hasExplicitFileTarget(text)) {
          const pickedFile = await window.electronAPI.readNamedTextFile(text)
          if (pickedFile) {
            await analyzeTextFile(pickedFile, `读取并分析：${pickedFile!.name}`)
            return
          }

          await streamAssistantMessage('我没有在桌面找到你指定的文本文件。你可以把文件名说得更完整，或者回复“单独文件”，我打开选择器让你选。')
          setPendingFileReadStep('awaitingScope')
          return
        }

        setPendingFileReadStep('awaitingConsent')
        await streamAssistantMessage('可以读取，但我需要先经过你确认。是否允许我读取你的本地文件？\n\n确认后，我会再问你要读取全部文件还是单独文件。')
        return
      }

      const enabledCustomTools = platformConfig?.customTools.filter((tool) => tool.enabled !== false) ?? []
      const matchedCustomTool = findBestCustomTool(enabledCustomTools, text)
      if (matchedCustomTool) {
        await autoRunCustomTool(matchedCustomTool, text)
        return
      }

      if (isRealtimeInfoRequest(text)) {
        await streamAssistantMessage(
          '这个问题需要实时 API 才能准确回答。当前没有匹配的 Tool。\n\n你可以到“设置 → 安装 HTTP API Tool”里添加对应 API，比如天气查询 API，并在描述里写清楚“用于查询城市天气”。添加后再问，我就可以自动调用它。',
        )
        return
      }

      await executeAgentRequest(text)
    } catch {
      const errorMessage: Message = {
        id: createMessageId(),
        role: 'assistant',
        content: 'AI 服务暂时不可用。请检查 API Key、网络、模型配置或 Electron 主进程日志。',
        createdAt: Date.now(),
      }

      setMessages((currentMessages) => [...currentMessages, errorMessage])
    } finally {
      agentAbortControllerRef.current = null
      setAssistantStatus('idle')
    }
  }

  async function analyzeTextFile(pickedFile: LocalTextFile, userMessageText?: string) {
    const userMessage: Message = {
      id: createMessageId(),
      role: 'user',
      content: userMessageText ?? `请分析本地文件：${pickedFile!.name}`,
      createdAt: Date.now(),
    }

    setMessages((currentMessages) => [...currentMessages, userMessage])
    setAssistantStatus('thinking')
    addToolLog({
      id: createMessageId(),
      name: 'readTextFile',
      status: 'success',
      detail: pickedFile!.name,
      createdAt: Date.now(),
    })

    if (!hasUsableModelProvider()) {
      await streamAssistantMessage(getUnavailableModelMessage([pickedFile]))
      setAssistantStatus('idle')
      return
    }

    try {
      const prompt =
        mode === 'user'
          ? `你不是普通聊天机器人，而是桌面 AI 管家。请把这个文件变成可执行工作流报告。

输出必须包含：
1. 报告摘要：用普通用户能看懂的话总结这个文件
2. 关键发现：列出最重要的数据、趋势或问题
3. 风险提醒：指出可能需要注意的异常
4. 下一步计划：给出可以执行的计划，每条要像待办事项
5. 今日可打卡事项：给出 1-3 个今天就能做的动作

${wrapUntrustedContent(pickedFile.name, pickedFile.content)}`
          : `请用开发者视角分析这个文件，输出：\n1. 文件职责\n2. 关键逻辑\n3. 风险或改进点\n4. 可以怎么写进项目介绍\n\n${wrapUntrustedContent(pickedFile.name, pickedFile.content)}`
      const assistantReply = await createAssistantReply(prompt)
      await streamAssistantMessage(assistantReply.content)
      queueGeneratedReport(assistantReply.content, pickedFile.name)
    } catch {
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: createMessageId(),
          role: 'assistant',
          content: '文件已读取，但 AI 分析失败。请检查网络、API Key 或文件内容。',
          createdAt: Date.now(),
        },
      ])
    } finally {
      setAssistantStatus('idle')
    }
  }

  async function analyzeDirectoryFiles() {
    if (!isElectronReady || !window.electronAPI?.pickTextDirectory) {
      return
    }

    setAssistantStatus('thinking')
    try {
      const files = await window.electronAPI.pickTextDirectory()
      if (files.length === 0) {
        await streamAssistantMessage('没有读取到可分析的文件。你可以选择包含 txt、md、json、log、csv、xlsx、docx、pptx、pdf、图片或代码文件的文件夹。')
        return
      }

      addToolLog({
        id: createMessageId(),
        name: 'readTextDirectory',
        status: 'success',
        detail: `${files.length} 个文件`,
        createdAt: Date.now(),
      })

      if (!hasUsableModelProvider()) {
        await streamAssistantMessage(getUnavailableModelMessage(files))
        return
      }

      const fileContext = wrapUntrustedCollection(files.map((file, index) => ({
        label: `文件 ${index + 1}: ${file.name}`,
        content: file.content.slice(0, 3000),
      })))
      const assistantReply = await createAssistantReply(
        `用户选择读取一个文件夹内的全部文件。你是桌面 AI 管家，请把这些资料变成可执行工作流报告。

输出必须包含：
1. 总体摘要
2. 每个文件的重点
3. 共同结论
4. 风险或异常
5. 下一步计划：每条像待办事项
6. 今日可打卡事项：给出 1-3 个今天就能做的动作

${fileContext}`,
      )
      await streamAssistantMessage(assistantReply.content)
      queueGeneratedReport(assistantReply.content, `文件夹：${files.length} 个文件`)
    } catch {
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: createMessageId(),
          role: 'assistant',
          content: '读取文件夹失败。请检查权限，或换一个文件夹再试。',
          createdAt: Date.now(),
        },
      ])
    } finally {
      setAssistantStatus('idle')
    }
  }

  function addPendingAttachments(files: LocalTextFile[]) {
    if (files.length === 0) {
      return
    }

    setPendingAttachments((currentFiles) => {
      const existingPaths = new Set(currentFiles.map((file) => file.path))
      const nextFiles = files
        .filter((file) => !existingPaths.has(file.path))
        .map((file) => ({
          ...file,
          id: createMessageId(),
        }))

      return [...currentFiles, ...nextFiles].slice(0, 10)
    })
  }

  async function addFilesToComposer() {
    if (!isElectronReady || isThinking) {
      return
    }

    const pickedFiles = await window.electronAPI.pickTextFiles()
    addPendingAttachments(pickedFiles)
  }

  function removePendingAttachment(id: number) {
    setPendingAttachments((currentFiles) => currentFiles.filter((file) => file.id !== id))
  }

  async function analyzePendingAttachments(userDescription: string, files: LocalTextFile[]) {
    const fileSummary = files.map((file) => file.name).join('、')
    const userMessage: Message = {
      id: createMessageId(),
      role: 'user',
      content: `${userDescription || '请分析这些文件并生成行动计划。'}\n\n附件：${fileSummary}`,
      createdAt: Date.now(),
    }

    setMessages((currentMessages) => [...currentMessages, userMessage])
    setAssistantStatus('thinking')

    if (!hasUsableModelProvider()) {
      await streamAssistantMessage(getUnavailableModelMessage(files))
      setAssistantStatus('idle')
      return
    }

    try {
      const fileContext = wrapUntrustedCollection(files.map((file, index) => ({
        label: `附件 ${index + 1}: ${file.name}`,
        content: file.content.slice(0, 4000),
      })))
      const assistantReply = await createAssistantReply(
        `你是桌面 AI 管家。用户发送了 ${files.length} 个本地文件，并补充了处理要求。

用户要求：
${userDescription || '无，默认请分析文件并生成可执行计划。'}

请输出：
1. 总体摘要
2. 每个文件的重点
3. 发现的问题或机会
4. 下一步计划
5. 今日任务
6. 后续需要跟踪的数据

附件内容：
${fileContext}`,
      )
      await streamAssistantMessage(assistantReply.content)
      queueGeneratedReport(
        assistantReply.content,
        files.length === 1 ? files[0].name : `${files.length} 个附件`,
      )
    } catch {
      await streamAssistantMessage('附件已读取，但 AI 分析失败。请检查模型配置或稍后再试。')
    } finally {
      setAssistantStatus('idle')
    }
  }

  async function summarizeTextFile() {
    if (!isElectronReady || !window.electronAPI?.pickTextFile) {
      return
    }

    const pickedFile = (await window.electronAPI.pickTextFile()) as LocalTextFile | null
    if (!pickedFile) {
      return
    }

    await analyzeTextFile(pickedFile)
  }

  async function analyzeDroppedFiles(files: FileList) {
    if (!isElectronReady || files.length === 0) {
      return
    }

    const remainingSlots = 10 - pendingAttachments.length
    const droppedFiles = Array.from(files).slice(0, Math.max(0, remainingSlots))
    const pickedFiles: LocalTextFile[] = []

    for (const droppedFile of droppedFiles) {
      const filePath = window.electronAPI.getPathForFile(droppedFile)
      if (!filePath) {
        continue
      }

      const pickedFile = await window.electronAPI.readDroppedFile(filePath)
      if (pickedFile) {
        pickedFiles.push(pickedFile)
      }
    }

    addPendingAttachments(pickedFiles)
    if (pickedFiles.length === 0) {
      await streamAssistantMessage('没有读取到可添加的文件。你可以换成文档、表格、PDF、图片或常见代码文件。')
    }
  }

  function handleDragOver(event: any) {
    event.preventDefault()
    if (event.dataTransfer.types.includes('Files')) {
      setIsDraggingFile(true)
    }
  }

  function handleDragLeave(event: any) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDraggingFile(false)
    }
  }

  async function handleDrop(event: any) {
    event.preventDefault()
    setIsDraggingFile(false)
    await analyzeDroppedFiles(event.dataTransfer.files)
  }

  function startResizePanel(side: 'left' | 'right', event: any) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = side === 'left' ? leftPanelWidth : rightPanelWidth

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX
      const nextWidth = side === 'left' ? startWidth + delta : startWidth - delta
      const clampedWidth = Math.min(520, Math.max(220, nextWidth))

      if (side === 'left') {
        setLeftPanelWidth(clampedWidth)
      } else {
        setRightPanelWidth(clampedWidth)
      }
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  async function importKnowledgeDocument() {
    if (!isElectronReady || !window.electronAPI?.pickTextFile) {
      return
    }

    const allowed = requestToolPermission('pickTextFile', '需要导入本地资料作为知识库')
    if (!allowed) {
      return
    }

    const pickedFile = await window.electronAPI.pickTextFile()
    if (!pickedFile) {
      return
    }

    const document: KnowledgeDocument = {
      id: createMessageId(),
      name: pickedFile!.name,
      content: pickedFile!.content,
      createdAt: Date.now(),
    }

    const indexedDocument = await window.electronAPI.upsertKnowledgeDocument(document)
    setKnowledgeDocuments((currentDocuments) => [document, ...currentDocuments].slice(0, 12))
    setKnowledgeIndex(await window.electronAPI.getKnowledgeDocuments())
    addToolLog({
      id: createMessageId(),
      name: 'rag.importDocument',
      status: 'success',
      detail: `${pickedFile!.name} / ${indexedDocument.chunkCount} 个检索片段`,
      createdAt: Date.now(),
    })
  }

  async function searchKnowledgeIndex() {
    const query = knowledgeQuery.trim()
    if (!isElectronReady || !query) return
    setKnowledgeResults(await window.electronAPI.searchKnowledge(query, platformConfig?.rag.topK ?? 5))
  }

  async function removeKnowledgeDocument(document: KnowledgeDocumentSummary) {
    if (!isElectronReady || !window.confirm(`从资料库删除“${document.name}”？\n\n原始本地文件不会被删除。`)) return
    await window.electronAPI.deleteKnowledgeDocument(document.id)
    setKnowledgeDocuments((documents) => documents.filter((item) => String(item.id) !== document.id))
    setKnowledgeResults((results) => results.filter((item) => item.documentId !== document.id))
    setKnowledgeIndex(await window.electronAPI.getKnowledgeDocuments())
  }

  async function loadAuditLogs(filters: AuditLogFilters = {}) {
    if (!isElectronReady) return
    setAuditLogsLoading(true)
    try {
      setAuditLogs(await window.electronAPI.getAuditLogs(filters))
    } finally {
      setAuditLogsLoading(false)
    }
  }

  async function openAuditLogs() {
    setWorkspacePage('logs')
    await loadAuditLogs({ limit: 300 })
  }

  async function exportAuditLogs(filters: AuditLogFilters) {
    if (!isElectronReady) return
    await window.electronAPI.exportAuditLogs(filters)
    await loadAuditLogs(filters)
  }

  async function clearAuditLogs() {
    if (!isElectronReady || !window.confirm('清理审计日志？\n\n该操作不会删除报告、计划、知识库或 Agent 运行记录。')) return
    setAuditLogsLoading(true)
    try {
      await window.electronAPI.clearAuditLogs()
      setAuditLogs(await window.electronAPI.getAuditLogs({ limit: 300 }))
    } finally {
      setAuditLogsLoading(false)
    }
  }

  async function exportUserData() {
    if (!isElectronReady) return
    await window.electronAPI.exportUserData()
    await loadAuditLogs({ limit: 300 })
  }

  async function clearUserData() {
    if (!isElectronReady || !window.confirm('清理全部本地工作数据？\n\n将删除报告、计划、行动记录、长期记忆、知识库和 Agent 运行历史。模型与 Tool 配置不会删除。建议先导出备份。')) return
    await window.electronAPI.clearUserData()
    setWorkflowData({ reports: [], plans: [], activities: [] })
    setKnowledgeDocuments([])
    setKnowledgeIndex([])
    setKnowledgeResults([])
    setMemoryNotes([])
    setAgentRuns([])
    setAuditLogs(await window.electronAPI.getAuditLogs({ limit: 300 }))
  }

  async function rememberCurrentGoal() {
    const note = input.trim()
    if (!note) return

    if (isElectronReady) {
      setMemoryNotes(await window.electronAPI.addMemoryNote(note))
    } else {
      setMemoryNotes((currentNotes) => [
        { id: createLocalId('memory'), text: note, category: 'context' as const, pinned: false, createdAt: Date.now(), updatedAt: Date.now() },
        ...currentNotes,
      ].slice(0, 8))
    }
    setInput('')
  }

  async function removeMemoryNote(noteId: string) {
    if (isElectronReady) {
      setMemoryNotes(await window.electronAPI.deleteMemoryNote(noteId))
    } else {
      setMemoryNotes((notes) => notes.filter((note) => note.id !== noteId))
    }
  }

  async function addMemoryFromForm() {
    const text = memoryForm.text.trim()
    if (!isElectronReady || !text) return
    const expiresAt = memoryForm.expiresOn
      ? new Date(`${memoryForm.expiresOn}T23:59:59`).getTime()
      : undefined
    setMemoryNotes(await window.electronAPI.addMemoryNote(text, memoryForm.category, expiresAt))
    setMemoryForm({ text: '', category: 'context', expiresOn: '' })
  }

  async function updateMemory(note: MemoryNote, patch: Partial<Pick<MemoryNote, 'text' | 'category' | 'pinned' | 'expiresAt'>>) {
    if (!isElectronReady) return
    setMemoryNotes(await window.electronAPI.updateMemoryNote(note.id, patch))
  }

  async function savePlatformConfig(nextConfig: AgentPlatformConfig) {
    if (!isElectronReady) {
      return
    }

    const savedConfig = await window.electronAPI.savePlatformConfig(nextConfig)
    setPlatformConfig(savedConfig)
  }

  async function refreshPlatformConfig() {
    if (!isElectronReady) {
      return
    }

    const nextConfig = await window.electronAPI.getPlatformConfig()
    setPlatformConfig(nextConfig)
  }

  async function openExtensionsFolder() {
    if (!isElectronReady) {
      return
    }

    const openedPath = await window.electronAPI.openExtensionsFolder()
    setExtensionsPath(openedPath)
  }

  async function setActiveProvider(providerId: string) {
    if (!platformConfig) {
      return
    }

    await savePlatformConfig({
      ...platformConfig,
      activeProviderId: providerId,
    })
  }

  async function saveRagSettings() {
    if (!platformConfig || !isElectronReady) return
    setRagStatus('正在保存 RAG 配置...')
    await savePlatformConfig(platformConfig)
    setRagStatus(platformConfig.rag.embeddingEnabled ? '配置已保存，可以重建向量索引。' : '已保存，当前使用 BM25 关键词检索。')
  }

  async function rebuildRagIndex() {
    if (!platformConfig || !isElectronReady) return
    setRagStatus('正在生成 Embedding，请稍候...')
    try {
      await savePlatformConfig(platformConfig)
      const result = await window.electronAPI.rebuildKnowledgeEmbeddings()
      setKnowledgeIndex(await window.electronAPI.getKnowledgeDocuments())
      setRagStatus(`完成：${result.documents} 份资料，${result.embeddings} 个向量，模型 ${result.model}。`)
    } catch {
      setRagStatus('向量索引失败，请检查 Provider API Key、Embedding URL 和模型名称。')
    }
  }

  async function addModelProvider() {
    if (!platformConfig || !providerForm.name.trim() || !providerForm.model.trim()) {
      return
    }

    const provider: ModelProviderConfig = {
      id: createLocalId('provider'),
      name: providerForm.name.trim(),
      type: providerForm.type,
      model: providerForm.model.trim(),
      baseUrl: providerForm.baseUrl.trim() || undefined,
      apiKey: providerForm.apiKey.trim() || undefined,
    }

    await savePlatformConfig({
      ...platformConfig,
      activeProviderId: provider.id,
      providers: [...platformConfig.providers, provider],
    })
    setProviderForm({
      name: '',
      type: 'openai-compatible',
      model: '',
      baseUrl: '',
      apiKey: '',
    })
  }

  async function addCustomSkill() {
    if (!platformConfig || !customSkillForm.name.trim() || !customSkillForm.prompt.trim()) {
      return
    }

    const customSkill: CustomSkillConfig = {
      id: editingSkillId ?? createLocalId('skill'),
      name: customSkillForm.name.trim(),
      description: customSkillForm.description.trim() || '用户安装的自定义 Prompt Skill',
      prompt: customSkillForm.prompt.trim(),
      enabled: true,
    }

    await savePlatformConfig({
      ...platformConfig,
      customSkills: editingSkillId
        ? platformConfig.customSkills.map((skill) => (skill.id === editingSkillId ? customSkill : skill))
        : [...platformConfig.customSkills, customSkill],
    })
    setCustomSkillForm({ name: '', description: '', prompt: '' })
    setEditingSkillId(null)
  }

  async function importCustomSkillDraft() {
    if (!isElectronReady || !window.electronAPI?.pickTextFile) {
      return
    }

    const pickedFile = (await window.electronAPI.pickTextFile()) as LocalTextFile | null
    if (!pickedFile) {
      return
    }

    const draft = parseImportedSkill(pickedFile)
    setCustomSkillForm(draft)
    setEditingSkillId(null)
    addToolLog({
      id: createMessageId(),
      name: 'skill.importDraft',
      status: 'success',
      detail: pickedFile.name,
      createdAt: Date.now(),
    })
  }

  async function addCustomTool() {
    if (!platformConfig || !customToolForm.name.trim() || !customToolForm.endpoint.trim()) {
      return
    }

    let structuredFields: Pick<CustomToolConfig, 'headers' | 'inputSchema' | 'queryParams' | 'bodyParams'>
    try {
      structuredFields = {
        headers: parseOptionalJsonObject<Record<string, string>>(customToolForm.headersJson, 'Headers'),
        inputSchema: parseOptionalJsonObject<NonNullable<CustomToolConfig['inputSchema']>>(customToolForm.inputSchemaJson, '输入 Schema'),
        queryParams: parseOptionalJsonObject<Record<string, string>>(customToolForm.queryParamsJson, 'Query 映射'),
        bodyParams: parseOptionalJsonObject<Record<string, string>>(customToolForm.bodyParamsJson, 'Body 映射'),
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Tool JSON 配置无效')
      return
    }

    const customTool: CustomToolConfig = {
      id: editingToolId ?? createLocalId('tool'),
      name: customToolForm.name.trim(),
      description: customToolForm.description.trim() || '用户安装的自定义 HTTP Tool',
      endpoint: customToolForm.endpoint.trim(),
      method: customToolForm.method,
      apiKey: customToolForm.apiKey.trim() || undefined,
      apiKeyPlacement: customToolForm.apiKeyPlacement,
      apiKeyName: customToolForm.apiKeyName.trim() || undefined,
      timeoutMs: customToolForm.timeoutMs,
      retries: customToolForm.retries,
      version: customToolForm.version.trim() || '1.0.0',
      responsePath: customToolForm.responsePath.trim() || undefined,
      ...structuredFields,
      enabled: true,
    }

    await savePlatformConfig({
      ...platformConfig,
      customTools: editingToolId
        ? platformConfig.customTools.map((tool) => (tool.id === editingToolId ? customTool : tool))
        : [...platformConfig.customTools, customTool],
    })
    setCustomToolForm({
      name: '',
      description: '',
      endpoint: '',
      method: 'POST',
      apiKey: '',
      apiKeyPlacement: 'bearer',
      apiKeyName: '',
      timeoutMs: 20000,
      retries: 0,
      version: '1.0.0',
      headersJson: '',
      inputSchemaJson: '',
      queryParamsJson: '',
      bodyParamsJson: '',
      responsePath: '',
    })
    setEditingToolId(null)
  }

  async function importCustomToolDraft() {
    if (!isElectronReady || !window.electronAPI?.pickTextFile) {
      return
    }

    const pickedFile = (await window.electronAPI.pickTextFile()) as LocalTextFile | null
    if (!pickedFile) {
      return
    }

    try {
      const draft = parseImportedTool(pickedFile)
      setCustomToolForm(draft)
      setEditingToolId(null)
      addToolLog({
        id: createMessageId(),
        name: 'tool.importDraft',
        status: 'success',
        detail: pickedFile.name,
        createdAt: Date.now(),
      })
    } catch {
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: createMessageId(),
          role: 'assistant',
          content: 'Tool 配置导入失败。请确认文件是 JSON，并包含 name、description、method、endpoint、apiKey 等字段。',
          createdAt: Date.now(),
        },
      ])
    }
  }

  async function toggleCustomSkill(skillId: string) {
    if (!platformConfig) {
      return
    }

    await savePlatformConfig({
      ...platformConfig,
      customSkills: platformConfig.customSkills.map((skill) =>
        skill.id === skillId ? { ...skill, enabled: skill.enabled === false } : skill,
      ),
    })
  }

  async function deleteCustomSkill(skillId: string) {
    if (!platformConfig) {
      return
    }

    const skill = platformConfig.customSkills.find((item) => item.id === skillId)
    if (skill?.source === 'extension') {
      window.alert('这是扩展文件夹自动加载的 Skill。要删除它，请从扩展文件夹中移除对应文件，然后点击“重新扫描”。')
      return
    }

    if (!window.confirm('确定删除这个 Skill 吗？')) {
      return
    }

    await savePlatformConfig({
      ...platformConfig,
      customSkills: platformConfig.customSkills.filter((skill) => skill.id !== skillId),
    })
  }

  function editCustomSkill(skill: CustomSkillConfig) {
    setEditingSkillId(skill.id)
    setCustomSkillForm({
      name: skill.name,
      description: skill.description,
      prompt: skill.prompt,
    })
    setSettingsPage('skill')
  }

  async function toggleCustomTool(toolId: string) {
    if (!platformConfig) {
      return
    }

    await savePlatformConfig({
      ...platformConfig,
      customTools: platformConfig.customTools.map((tool) =>
        tool.id === toolId ? { ...tool, enabled: tool.enabled === false } : tool,
      ),
    })
  }

  async function deleteCustomTool(toolId: string) {
    if (!platformConfig) {
      return
    }

    const tool = platformConfig.customTools.find((item) => item.id === toolId)
    if (tool?.source === 'extension') {
      window.alert('这是扩展文件夹自动加载的 Tool。要删除它，请从扩展文件夹中移除对应文件，然后点击“重新扫描”。')
      return
    }

    if (!window.confirm('确定删除这个 Tool 吗？')) {
      return
    }

    await savePlatformConfig({
      ...platformConfig,
      customTools: platformConfig.customTools.filter((tool) => tool.id !== toolId),
      deletedBuiltinToolIds: toolId.startsWith('builtin-')
        ? [...new Set([...(platformConfig.deletedBuiltinToolIds ?? []), toolId])]
        : platformConfig.deletedBuiltinToolIds,
    })
  }

  function editCustomTool(tool: CustomToolConfig) {
    setEditingToolId(tool.id)
    setCustomToolForm({
      name: tool.name,
      description: tool.description,
      endpoint: tool.endpoint,
      method: tool.method,
      apiKey: tool.apiKey ?? '',
      apiKeyPlacement: tool.apiKeyPlacement ?? 'bearer',
      apiKeyName: tool.apiKeyName ?? '',
      timeoutMs: tool.timeoutMs ?? 20000,
      retries: tool.retries ?? 0,
      version: tool.version ?? '1.0.0',
      headersJson: tool.headers ? JSON.stringify(tool.headers, null, 2) : '',
      inputSchemaJson: tool.inputSchema ? JSON.stringify(tool.inputSchema, null, 2) : '',
      queryParamsJson: tool.queryParams ? JSON.stringify(tool.queryParams, null, 2) : '',
      bodyParamsJson: tool.bodyParams ? JSON.stringify(tool.bodyParams, null, 2) : '',
      responsePath: tool.responsePath ?? '',
    })
    setSettingsPage('tool')
  }

  function viewBuiltinSkill(skill: (typeof skillRegistry)[number]) {
    window.alert(
      `内置 Skill：${builtinSkillOverrides[skill.id]?.name ?? skill.name}\n\n描述：${
        builtinSkillOverrides[skill.id]?.description ?? skill.description
      }\n\n依赖工具：${skill.requiredTools.join(', ') || '无'}\n\n说明：内置 Skill 可以在本地修改显示信息、禁用或隐藏。`,
    )
  }

  function editBuiltinSkill(skill: (typeof skillRegistry)[number]) {
    const current = builtinSkillOverrides[skill.id] ?? {}
    const nextName = window.prompt('修改 Skill 名称', current.name ?? skill.name)
    if (nextName === null) {
      return
    }

    const nextDescription = window.prompt('修改 Skill 描述', current.description ?? skill.description)
    if (nextDescription === null) {
      return
    }

    setBuiltinSkillOverrides((currentOverrides) => ({
      ...currentOverrides,
      [skill.id]: {
        ...currentOverrides[skill.id],
        name: nextName.trim() || skill.name,
        description: nextDescription.trim() || skill.description,
      },
    }))
  }

  function toggleBuiltinSkill(skillId: string) {
    setBuiltinSkillOverrides((currentOverrides) => ({
      ...currentOverrides,
      [skillId]: {
        ...currentOverrides[skillId],
        enabled: currentOverrides[skillId]?.enabled === false,
      },
    }))
  }

  function deleteBuiltinSkill(skillId: string) {
    if (!window.confirm('确定隐藏这个内置 Skill 吗？隐藏后可以通过“恢复内置项”找回。')) {
      return
    }

    setBuiltinSkillOverrides((currentOverrides) => ({
      ...currentOverrides,
      [skillId]: {
        ...currentOverrides[skillId],
        deleted: true,
      },
    }))
  }

  function viewBuiltinTool(tool: (typeof toolRegistry)[number]) {
    window.alert(
      `内置 Tool：${builtinToolOverrides[tool.name]?.name ?? tool.label}\n\n描述：${
        builtinToolOverrides[tool.name]?.description ?? tool.description
      }\n\n风险：${tool.riskLevel}\n是否需要确认：${tool.requiresPermission ? '是' : '否'}`,
    )
  }

  function editBuiltinTool(tool: (typeof toolRegistry)[number]) {
    const current = builtinToolOverrides[tool.name] ?? {}
    const nextName = window.prompt('修改 Tool 名称', current.name ?? tool.label)
    if (nextName === null) {
      return
    }

    const nextDescription = window.prompt('修改 Tool 描述', current.description ?? tool.description)
    if (nextDescription === null) {
      return
    }

    setBuiltinToolOverrides((currentOverrides) => ({
      ...currentOverrides,
      [tool.name]: {
        ...currentOverrides[tool.name],
        name: nextName.trim() || tool.label,
        description: nextDescription.trim() || tool.description,
      },
    }))
  }

  function toggleBuiltinTool(toolName: string) {
    setBuiltinToolOverrides((currentOverrides) => ({
      ...currentOverrides,
      [toolName]: {
        ...currentOverrides[toolName],
        enabled: currentOverrides[toolName]?.enabled === false,
      },
    }))
  }

  function deleteBuiltinTool(toolName: string) {
    if (!window.confirm('确定隐藏这个内置 Tool 吗？隐藏后可以通过“恢复内置项”找回。')) {
      return
    }

    setBuiltinToolOverrides((currentOverrides) => ({
      ...currentOverrides,
      [toolName]: {
        ...currentOverrides[toolName],
        deleted: true,
      },
    }))
  }

  function restoreBuiltinItems() {
    setBuiltinSkillOverrides({})
    setBuiltinToolOverrides({})
  }

  async function runCustomSkill(customSkill: CustomSkillConfig) {
    if (isThinking) {
      return
    }

    const skillInput = input.trim()
    const userMessage: Message = {
      id: createMessageId(),
      role: 'user',
      content: `运行自定义 Skill：${customSkill.name}${skillInput ? `\n补充：${skillInput}` : ''}`,
      createdAt: Date.now(),
    }

    setMessages((currentMessages) => [...currentMessages, userMessage])
    setInput('')
    setAssistantStatus('thinking')
    setAgentTimeline([])

    try {
      const reply = await createAssistantReply(
        `${customSkill.prompt}\n\n用户补充：\n${skillInput || '无'}\n\n最近对话：\n${
          messages.map((message) => `${message.role}: ${message.content}`).slice(-8).join('\n') || '暂无'
        }`,
      )
      await streamAssistantMessage(reply.content)
    } catch {
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: createMessageId(),
          role: 'assistant',
          content: `自定义 Skill「${customSkill.name}」执行失败，请检查当前模型配置。`,
          createdAt: Date.now(),
        },
      ])
    } finally {
      setAssistantStatus('idle')
    }
  }

  async function runCustomTool(customTool: CustomToolConfig) {
    if (isThinking || !isElectronReady) {
      return
    }

    const toolInput = input.trim()
    const allowed = requestToolPermission(customTool.name, `将向 ${customTool.endpoint} 发送请求`)
    if (!allowed) {
      return
    }

    setAssistantStatus('thinking')
    setInput('')
    addTimelineStep({
      id: createMessageId(),
      title: '调用自定义 Tool',
      detail: customTool.name,
      status: 'success',
      createdAt: Date.now(),
    })

    try {
      const result = await window.electronAPI.invokeCustomTool(customTool.id, toolInput)
      addToolLog({
        id: createMessageId(),
        name: `custom:${customTool.name}`,
        status: 'success',
        detail: result.content.slice(0, 160),
        createdAt: Date.now(),
      })
      await streamAssistantMessage(`自定义 Tool「${result.name}」返回：\n\n${result.content}`)
    } catch {
      addToolLog({
        id: createMessageId(),
        name: `custom:${customTool.name}`,
        status: 'error',
        detail: '调用失败',
        createdAt: Date.now(),
      })
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: createMessageId(),
          role: 'assistant',
          content: `自定义 Tool「${customTool.name}」调用失败，请检查接口地址、方法或 API Key。`,
          createdAt: Date.now(),
        },
      ])
    } finally {
      setAssistantStatus('idle')
    }
  }

  async function autoRunCustomTool(customTool: CustomToolConfig, userText: string) {
    const allowed = requestToolPermission(customTool.name, `根据你的问题自动调用：${customTool.description}`)
    if (!allowed) {
      await streamAssistantMessage('好的，我不会调用这个 Tool。')
      return
    }

    addTimelineStep({
      id: createMessageId(),
      title: '自动选择 Tool',
      detail: customTool.name,
      status: 'success',
      createdAt: Date.now(),
    })

    try {
      const result = await window.electronAPI.invokeCustomTool(customTool.id, userText)
      addToolLog({
        id: createMessageId(),
        name: `custom:${customTool.name}`,
        status: 'success',
        detail: result.content.slice(0, 160),
        createdAt: Date.now(),
      })

      const reply = await createAssistantReply(
        `用户问题：${userText}

你已经调用了自定义 Tool「${result.name}」，返回结果如下：

${result.content}

请基于 Tool 返回结果，用简洁中文回答用户。`,
      )
      await streamAssistantMessage(reply.content)
    } catch {
      addToolLog({
        id: createMessageId(),
        name: `custom:${customTool.name}`,
        status: 'error',
        detail: '自动调用失败',
        createdAt: Date.now(),
      })
      await streamAssistantMessage(`我尝试调用「${customTool.name}」，但接口请求失败。请检查 Tool 的 Endpoint、参数占位符或 API Key。`)
    }
  }

  async function runSkill(skillId: SkillId) {
    if (isThinking) {
      return
    }

    const skill = getSkillDefinition(skillId)
    if (!skill) {
      return
    }

    const skillInput = input.trim()
    const userMessage: Message = {
      id: createMessageId(),
      role: 'user',
      content: `运行 Skill：${skill.name}${skillInput ? `\n补充：${skillInput}` : ''}`,
      createdAt: Date.now(),
    }

    setMessages((currentMessages) => [...currentMessages, userMessage])
    setInput('')
    setAssistantStatus('thinking')
    setAgentTimeline([])
    addTimelineStep({
      id: createMessageId(),
      title: '运行 Skill',
      detail: skill.name,
      status: 'success',
      createdAt: Date.now(),
    })

    try {
      const reply = await skill.run({
        userInput: skillInput,
        messages: messages.map((message) => `${message.role}: ${message.content}`),
        toolLogs,
        timeline: agentTimeline,
        knowledgeDocuments,
        memoryNotes: memoryNotes.map((note) => note.text),
        addToolLog,
        addTimelineStep,
        requestPermission: requestToolPermission,
      })
      await streamAssistantMessage(reply.content)
    } catch {
      const errorMessage: Message = {
        id: createMessageId(),
        role: 'assistant',
        content: `Skill「${skill.name}」执行失败。请检查 AI 服务或工具权限。`,
        createdAt: Date.now(),
      }

      setMessages((currentMessages) => [...currentMessages, errorMessage])
    } finally {
      setAssistantStatus('idle')
    }
  }

  function startButlerScenario(scenario: ButlerScenario) {
    if (scenario === 'file') {
      void summarizeTextFile()
      return
    }

    if (scenario === 'trip') {
      setTripDraft({})
      setTripPlannerOpen(true)
      return
    }

    if (scenario === 'study') {
      setInput('我想做学习计划。我会导入学习记录或成绩表，请帮我分析薄弱项，生成复习计划、今日任务和后续跟踪方案。')
      setWorkspacePage('data')
      return
    }

    if (scenario === 'workReport') {
      setInput('请根据最近的报告、行动记录和计划，帮我生成一份工作周报，并提取下周待办。')
      return
    }

    if (scenario === 'expense') {
      setInput('我想整理报销或支出数据。请分析费用异常、缺票问题、预算超支，并生成处理计划。')
      setWorkspacePage('data')
      return
    }

    setWorkspacePage('plans')
  }

  function renderWorkspaceHome() {
    return renderCoreWorkspaceHome()
    /* Legacy workspace entries remain below temporarily while detail views are split into components. */
    /* oxlint-disable no-unreachable */
    return (
      <>
        <div className="workspace-intro">
          <strong>管家场景中心</strong>
          <span>选择你现在要处理的事，管家会把资料、API、报告、计划和提醒串起来。</span>
        </div>
        <button className="settings-entry workspace-entry highlight" onClick={() => startButlerScenario('today')}>
          <span>
            <strong>今日任务</strong>
            <small>今天需要推进的计划、到点提醒和停滞项。</small>
          </span>
          <b>{todayPlans.length} 个</b>
        </button>
        <button
          className="settings-entry workspace-entry"
          onClick={() => startButlerScenario('trip')}
        >
          <span>
            <strong>出差规划</strong>
            <small>结合历史记录和 API Tool 规划交通、天气、酒店、预算。</small>
          </span>
          <b>Agent</b>
        </button>
        <button className="settings-entry workspace-entry" onClick={() => startButlerScenario('file')}>
          <span>
            <strong>文件变行动</strong>
            <small>拖拽或选择文件，生成报告、计划、今日任务。</small>
          </span>
          <b>{knowledgeIndex.length} 份</b>
        </button>
        <button className="settings-entry workspace-entry" onClick={() => setWorkspacePage('knowledge')}>
          <span>
            <strong>本地资料库</strong>
            <small>管理已索引文档，测试检索结果和来源片段。</small>
          </span>
          <b>{knowledgeIndex.reduce((sum, item) => sum + item.chunkCount, 0)} 段</b>
        </button>
        <button className="settings-entry workspace-entry" onClick={() => setWorkspacePage('runs')}>
          <span>
            <strong>Agent 运行记录</strong>
            <small>查看目标、执行轮次、工具观察和失败原因。</small>
          </span>
          <b>{agentRuns.length} 次</b>
        </button>
        <button className="settings-entry workspace-entry" onClick={() => setWorkspacePage('metrics')}>
          <span>
            <strong>Agent 指标</strong>
            <small>查看成功率、工具表现、执行轮数、失败分布和响应延迟。</small>
          </span>
          <b>Metrics</b>
        </button>
        <button className="settings-entry workspace-entry" onClick={() => setWorkspacePage('eval')}>
          <span><strong>Agent Eval</strong><small>运行本地 RAG 基准，查看 Recall@5、MRR 和 NDCG。</small></span>
          <b>70 题</b>
        </button>
        <button className="settings-entry workspace-entry" onClick={openAuditLogs}>
          <span>
            <strong>审计日志</strong>
            <small>筛选 Agent、工具、文件、配置与系统错误，支持导出诊断。</small>
          </span>
          <b>{auditLogs.filter((log) => log.status === 'failure').length > 0 ? `${auditLogs.filter((log) => log.status === 'failure').length} 个异常` : `${auditLogs.length} 条`}</b>
        </button>
        <button className="settings-entry workspace-entry" onClick={() => startButlerScenario('expense')}>
          <span>
            <strong>报销/支出整理</strong>
            <small>分析费用异常、缺票、预算超支并生成处理计划。</small>
          </span>
          <b>办公</b>
        </button>
        <button className="settings-entry workspace-entry" onClick={() => startButlerScenario('study')}>
          <span>
            <strong>学习计划</strong>
            <small>分析学习记录或成绩表，生成复习计划和跟踪任务。</small>
          </span>
          <b>个人</b>
        </button>
        <button className="settings-entry workspace-entry" onClick={() => startButlerScenario('workReport')}>
          <span>
            <strong>工作汇报</strong>
            <small>根据报告、行动记录和计划生成周报与下周待办。</small>
          </span>
          <b>汇报</b>
        </button>
        <button className="settings-entry workspace-entry" onClick={() => setWorkspacePage('reports')}>
          <span>
            <strong>报告行动中心</strong>
            <small>查看报告，或固定为可侧边收起的桌面行动卡。</small>
          </span>
          <b>{workflowData.reports.length} 份</b>
        </button>
        <button className="settings-entry workspace-entry" onClick={() => setWorkspacePage('plans')}>
          <span>
            <strong>计划跟踪</strong>
            <small>记录进度、AI 复盘、调整下一步。</small>
          </span>
          <b>{stalePlans.length > 0 ? `${stalePlans.length} 个停滞` : `${activePlans.length} 个`}</b>
        </button>
        <button className="settings-entry workspace-entry" onClick={() => setWorkspacePage('activity')}>
          <span>
            <strong>行动记录</strong>
            <small>记录你做过什么，后续用于调整计划。</small>
          </span>
          <b>{workflowData.activities.length} 条</b>
        </button>
        <button className="settings-entry workspace-entry" onClick={() => setWorkspacePage('memory')}>
          <span>
            <strong>长期记忆</strong>
            <small>保存你的偏好、目标和长期背景。</small>
          </span>
          <b>{memoryNotes.length} 条</b>
        </button>
      </>
    )
  }

  function renderWorkspaceDetail() {
    if (workspacePage === 'data') {
      return (
        <div className="insight-section">
          <h3>资料分析</h3>
          <p>可以直接把文件拖进软件，也可以手动选择文件或导入资料库。</p>
          <button className="panel-action-button" onClick={summarizeTextFile} disabled={isThinking || !isElectronReady}>
            选择文件并分析
          </button>
          <button className="panel-action-button" onClick={importKnowledgeDocument} disabled={isThinking || !isElectronReady}>
            导入到资料库
          </button>
          <button className="panel-action-button" onClick={generateReportFromConversation} disabled={isThinking || !isElectronReady}>
            根据对话生成报告
          </button>
        </div>
      )
    }

    if (workspacePage === 'knowledge') {
      return (
        <KnowledgePanel
          documents={knowledgeIndex}
          results={knowledgeResults}
          query={knowledgeQuery}
          disabled={isThinking || !isElectronReady}
          onQueryChange={setKnowledgeQuery}
          onSearch={searchKnowledgeIndex}
          onImport={importKnowledgeDocument}
          onRemove={removeKnowledgeDocument}
        />
      )
    }

    if (workspacePage === 'runs') {
      return <AgentRunsPanel runs={agentRuns} />
    }

    if (workspacePage === 'metrics') {
      return <MetricsPanel runs={agentRuns} logs={auditLogs} />
    }

    if (workspacePage === 'eval') {
      return <EvalPanel />
    }

    if (workspacePage === 'logs') {
      return (
        <AuditLogPanel
          logs={auditLogs}
          loading={auditLogsLoading}
          onLoad={loadAuditLogs}
          onExport={exportAuditLogs}
          onClear={clearAuditLogs}
        />
      )
    }

    if (workspacePage === 'reports') {
      return (
        <div className="insight-section">
          <h3>报告行动中心</h3>
          {latestReport ? (
            <div className="report-card">
              <strong>{latestReport.title}</strong>
              <p>{latestReport.summary}</p>
              <div className="report-actions">
                <button className="panel-action-button" onClick={() => openFloatingReport(latestReport.id)} disabled={!isElectronReady}>
                  固定到桌面边缘
                </button>
                <button onClick={() => deleteReport(latestReport)}>删除</button>
              </div>
              <small>报告会以置顶小窗显示，方便你边工作边看结论和计划。</small>
            </div>
          ) : (
            <p>还没有报告。分析文件后，我会自动保存报告并提取计划。</p>
          )}
          <div className="compact-list">
            {workflowData.reports.slice(1, 8).map((report) => (
              <div className="compact-report" key={report.id}>
                <button onClick={() => openFloatingReport(report.id)}>{report.title}</button>
                <button onClick={() => deleteReport(report)}>删除</button>
              </div>
            ))}
          </div>
        </div>
      )
    }

    if (workspacePage === 'plans') {
      return (
        <div className="insight-section">
          <h3>计划跟踪</h3>
          <div className="today-task-list">
            <strong>今日任务</strong>
            {todayPlans.length === 0 ? (
              <p>今天没有待推进计划。</p>
            ) : (
              todayPlans.slice(0, 4).map((plan) => (
                <div key={plan.id} className={`today-task ${isPlanStale(plan) ? 'stale' : ''}`}>
                  <span>{plan.title}</span>
                  <small>
                    {isPlanStale(plan)
                      ? '已停滞，建议拆小任务'
                      : plan.reminderTime
                        ? `提醒 ${plan.reminderTime}`
                        : '今天还未记录进度'}
                  </small>
                </div>
              ))
            )}
          </div>
          <div className="plan-form">
            <input
              value={planForm.title}
              placeholder="计划标题，例如 每天整理项目 30 分钟"
              onChange={(event) => setPlanForm({ ...planForm, title: event.target.value })}
            />
            <textarea
              value={planForm.description}
              placeholder="计划说明，可选"
              onChange={(event) => setPlanForm({ ...planForm, description: event.target.value })}
            />
            <div className="plan-form-grid">
              <label>
                优先级
                <select value={planForm.priority} onChange={(event) => setPlanForm({ ...planForm, priority: event.target.value as ButlerPlan['priority'] })}>
                  <option value="high">高</option>
                  <option value="medium">中</option>
                  <option value="low">低</option>
                </select>
              </label>
              <label>
                截止日期
                <input type="date" value={planForm.dueDate} onChange={(event) => setPlanForm({ ...planForm, dueDate: event.target.value })} />
              </label>
              <label>
                重复
                <select value={planForm.recurrence} onChange={(event) => setPlanForm({ ...planForm, recurrence: event.target.value as ButlerPlan['recurrence'] })}>
                  <option value="none">不重复</option>
                  <option value="daily">每天</option>
                  <option value="weekly">每周</option>
                </select>
              </label>
            </div>
            <button onClick={addPlanFromForm} disabled={!isElectronReady || !planForm.title.trim()}>
              添加计划
            </button>
          </div>
          <div className="plan-list">
            {workflowData.plans.length === 0 ? (
              <p>暂无计划。生成报告后会自动提取，或者你可以手动添加。</p>
            ) : (
              workflowData.plans.map((plan) => (
                <div key={plan.id} className={`plan-item ${plan.status}`}>
                  <div className="plan-title-row">
                    <strong>{plan.title}</strong>
                    <span className={`priority-badge ${plan.priority}`}>{plan.priority === 'high' ? '高优先级' : plan.priority === 'low' ? '低优先级' : '中优先级'}</span>
                  </div>
                  <small>
                    完成度 {plan.progress}% · 记录 {plan.checkins} 次 · 最近 {formatShortTime(plan.lastCheckinAt)}
                    {plan.reminderTime ? ` · 每天 ${plan.reminderTime} 提醒` : ''}
                    {plan.dueDate ? ` · 截止 ${plan.dueDate}` : ''}
                  </small>
                  <div className="plan-progress" aria-label={`完成度 ${plan.progress}%`}><span style={{ width: `${plan.progress}%` }} /></div>
                  {isPlanStale(plan) && <div className="stale-badge">停滞 {getDaysSince(plan.lastCheckinAt ?? plan.createdAt)} 天，建议拆小任务</div>}
                  <p>{plan.description}</p>
                  <label className="reminder-row">
                    提醒时间
                    <input
                      type="time"
                      value={plan.reminderTime ?? ''}
                      onChange={(event) => updatePlanReminder(plan, event.target.value)}
                    />
                  </label>
                  <div className="plan-meta-grid">
                    <label>
                      优先级
                      <select value={plan.priority} onChange={(event) => updatePlanDetails(plan, { priority: event.target.value as ButlerPlan['priority'] })}>
                        <option value="high">高</option><option value="medium">中</option><option value="low">低</option>
                      </select>
                    </label>
                    <label>
                      截止日期
                      <input type="date" value={plan.dueDate ?? ''} onChange={(event) => updatePlanDetails(plan, { dueDate: event.target.value || undefined })} />
                    </label>
                    <label>
                      重复
                      <select value={plan.recurrence} onChange={(event) => updatePlanDetails(plan, { recurrence: event.target.value as ButlerPlan['recurrence'] })}>
                        <option value="none">不重复</option><option value="daily">每天</option><option value="weekly">每周</option>
                      </select>
                    </label>
                  </div>
                  <label className="next-action-row">
                    下一步
                    <input
                      defaultValue={plan.nextAction ?? ''}
                      placeholder="下一步最小行动"
                      onBlur={(event) => updatePlanDetails(plan, { nextAction: event.target.value || undefined })}
                    />
                  </label>
                  <div className="plan-actions">
                    <button onClick={() => startProgressRecord(plan)} disabled={plan.status === 'done'}>
                      记录进度
                    </button>
                    <button className="pin-action" onClick={() => openFloatingPlan(plan.id)} disabled={!isElectronReady}>
                      <Pin aria-hidden="true" size={15} />固定到桌面
                    </button>
                    <button onClick={() => togglePlanDone(plan)}>
                      {plan.status === 'done' ? '继续' : '完成'}
                    </button>
                    <button className="danger-action" onClick={() => deletePlan(plan.id)} title="删除计划">
                      <Trash2 aria-hidden="true" size={15} />删除
                    </button>
                  </div>
                  {isPlanStale(plan) && (
                    <button className="split-plan-button" onClick={() => splitStalePlan(plan)} disabled={isThinking}>
                      AI 拆小任务
                    </button>
                  )}
                  {progressDraft.planId === plan.id && (
                    <div className="progress-editor">
                      <label>
                        完成度
                        <select
                          value={progressDraft.completion}
                          onChange={(event) =>
                            setProgressDraft({ ...progressDraft, completion: event.target.value })
                          }
                        >
                          <option value="25">25%</option>
                          <option value="50">50%</option>
                          <option value="75">75%</option>
                          <option value="100">100%</option>
                        </select>
                      </label>
                      <textarea
                        value={progressDraft.note}
                        placeholder="今天这个任务具体做了什么？"
                        onChange={(event) => setProgressDraft({ ...progressDraft, note: event.target.value })}
                      />
                      <textarea
                        value={progressDraft.blocker}
                        placeholder="遇到的问题，可选"
                        onChange={(event) => setProgressDraft({ ...progressDraft, blocker: event.target.value })}
                      />
                      <div className="progress-actions">
                        <button onClick={() => submitPlanProgress(plan)} disabled={isThinking || !progressDraft.note.trim()}>
                          AI 复盘
                        </button>
                        <button onClick={() => setProgressDraft({ planId: '', note: '', completion: '50', blocker: '' })}>
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )
    }

    if (workspacePage === 'activity') {
      return (
        <div className="insight-section">
          <h3>行动记录</h3>
          <div className="activity-form">
            <input
              value={activityNote}
              placeholder="记录今天做了什么，方便之后调整计划"
              onChange={(event) => setActivityNote(event.target.value)}
            />
            <button onClick={addActivityNote} disabled={!isElectronReady || !activityNote.trim()}>
              记录
            </button>
          </div>
          <div className="activity-list">
            {workflowData.activities.length === 0 ? (
              <p>还没有行动记录。</p>
            ) : (
              workflowData.activities.map((activity) => (
                <div key={activity.id} className="activity-item">
                  <span><strong>{activity.text}</strong><small>{new Date(activity.createdAt).toLocaleString('zh-CN')}</small></span>
                  <button onClick={() => deleteActivity(activity)}>删除</button>
                </div>
              ))
            )}
          </div>
        </div>
      )
    }

    return (
      <div className="insight-section">
        <h3>长期记忆</h3>
        <p>已保存 {memoryNotes.length} 条记忆。可以分类、置顶、编辑和设置有效期。</p>
        <div className="memory-form">
          <textarea value={memoryForm.text} placeholder="记录偏好、目标、事实或长期背景" onChange={(event) => setMemoryForm({ ...memoryForm, text: event.target.value })} />
          <div>
            <select value={memoryForm.category} onChange={(event) => setMemoryForm({ ...memoryForm, category: event.target.value as MemoryNote['category'] })}>
              <option value="preference">偏好</option><option value="goal">目标</option><option value="context">背景</option><option value="fact">事实</option>
            </select>
            <input type="date" value={memoryForm.expiresOn} title="有效期，可选" onChange={(event) => setMemoryForm({ ...memoryForm, expiresOn: event.target.value })} />
            <button onClick={addMemoryFromForm} disabled={!isElectronReady || !memoryForm.text.trim()}>添加记忆</button>
          </div>
        </div>
        <button className="panel-action-button" onClick={rememberCurrentGoal}>
          保存当前输入
        </button>
        <div className="memory-list">
          {memoryNotes.map((note) => (
            <div className="memory-item" key={note.id}>
              <div className="memory-content">
                <textarea defaultValue={note.text} onBlur={(event) => {
                  const nextText = event.target.value.trim()
                  if (nextText && nextText !== note.text) void updateMemory(note, { text: nextText })
                }} />
                <small>{note.category === 'preference' ? '偏好' : note.category === 'goal' ? '目标' : note.category === 'fact' ? '事实' : '背景'}{note.pinned ? ' · 已置顶' : ''}{note.expiresAt ? ` · 有效至 ${new Date(note.expiresAt).toLocaleDateString('zh-CN')}` : ''}</small>
              </div>
              <div className="memory-actions">
                <button onClick={() => updateMemory(note, { pinned: !note.pinned })}>{note.pinned ? '取消置顶' : '置顶'}</button>
                <button onClick={() => removeMemoryNote(note.id)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  function renderCoreWorkspaceHome() {
    return (
      <div className="core-workspace-grid">
        <button className="settings-entry workspace-entry highlight" onClick={() => setWorkspacePage('plans')}>
          <span><strong>今日任务</strong><small>今天要推进的计划、提醒和停滞项。</small></span>
          <b>{todayPlans.length} 个</b>
        </button>
        <button className="settings-entry workspace-entry" onClick={() => setWorkspacePage('reports')}>
          <span><strong>报告</strong><small>查看分析结论并固定为桌面行动卡。</small></span>
          <b>{workflowData.reports.length} 份</b>
        </button>
        <button className="settings-entry workspace-entry" onClick={() => setWorkspacePage('plans')}>
          <span><strong>计划</strong><small>记录进度、AI 复盘并调整下一步。</small></span>
          <b>{activePlans.length} 个</b>
        </button>
        <button className="settings-entry workspace-entry" onClick={() => setWorkspacePage('knowledge')}>
          <span><strong>资料库</strong><small>管理本地资料和来源检索。</small></span>
          <b>{knowledgeIndex.length} 份</b>
        </button>
      </div>
    )
  }

  function renderUserWorkspacePanel() {
    return (
      <>
        {workspacePage !== 'home' && (
          <button className="workspace-back-button" onClick={() => setWorkspacePage('home')}>
            返回工作台
          </button>
        )}
        {workspacePage === 'home' ? renderWorkspaceHome() : renderWorkspaceDetail()}
      </>
    )
  }

  return (
    <main
      className={`app-shell user-mode ${isDraggingFile ? 'dragging-file' : ''}`}
      style={{
        gridTemplateColumns: `${leftPanelCollapsed ? 44 : leftPanelWidth}px 6px minmax(420px, 1fr) 6px ${rightPanelCollapsed ? 44 : rightPanelWidth}px`,
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {!isElectronReady && (
        <div className="environment-banner">
          浏览器预览模式：桌面工具、文件读取、AI 主进程调用不可用。请用 npm run dev:electron 启动。
        </div>
      )}
      {isDraggingFile && (
        <div className="drop-overlay">
          <strong>松开鼠标，添加到聊天框</strong>
          <span>最多 10 个文件，添加后可以先写描述，再点发送</span>
        </div>
      )}

      <aside className={`panel-shell left-shell ${leftPanelCollapsed ? 'collapsed' : ''}`}>
        <button
          className="panel-collapse-button"
          onClick={() => setLeftPanelCollapsed((currentValue) => !currentValue)}
          title={leftPanelCollapsed ? '展开左侧管家面板' : '折叠左侧管家面板'}
        >
          {leftPanelCollapsed ? <ChevronRight aria-hidden="true" size={16} /> : <ChevronLeft aria-hidden="true" size={16} />}
        </button>
        {!leftPanelCollapsed && (
          <AvatarPanel
            appName={appName}
            appVersion={appVersion}
            systemInfoText={systemInfoText}
            statusText={getAssistantStatusText(assistantStatus)}
          />
        )}
      </aside>

      <div
        className={`resize-handle left-resize ${leftPanelCollapsed ? 'disabled' : ''}`}
        onMouseDown={(event) => !leftPanelCollapsed && startResizePanel('left', event)}
      />

      <section className="chat-panel">
        <header className="chat-header">
          <div>
            <div className="eyebrow">Desktop Butler Agent</div>
            <h1>桌面 AI 管家</h1>
            <p>把资料、行程、计划和工具串起来，让事情更省心</p>
          </div>
          <div className="header-actions">
            <button className="settings-button" onClick={() => setSettingsOpen(true)}>
              <Settings aria-hidden="true" size={17} />
              <span>设置</span>
            </button>
          </div>
        </header>

        <section className="quick-start">
          <button onClick={() => startButlerScenario('file')} disabled={isThinking || !isElectronReady}>
            <FileText aria-hidden="true" size={18} />
            <strong>文件变行动</strong>
            <span>分析资料，生成报告、计划和今日任务</span>
          </button>
          <button onClick={() => startButlerScenario('trip')}>
            <Plane aria-hidden="true" size={18} />
            <strong>出差规划</strong>
            <span>交通、天气、酒店、预算和报销清单</span>
          </button>
          <button onClick={() => startButlerScenario('expense')}>
            <ReceiptText aria-hidden="true" size={18} />
            <strong>报销整理</strong>
            <span>找异常、缺票、超预算并持续跟踪</span>
          </button>
          <button onClick={() => startButlerScenario('today')}>
            <ListChecks aria-hidden="true" size={18} />
            <strong>今日任务</strong>
            <span>提醒、进度复盘和停滞拆解</span>
          </button>
        </section>

        <MessageList messages={messages} />

        {pendingReportCard && (
          <section className="trip-result-card" aria-label="分析结果保存选项">
            <div className="trip-result-heading">
              <div>
                <strong>{pendingReportCard.title}</strong>
                <span>分析已完成，保存前由你确认</span>
              </div>
              <button className="icon-button" title="关闭结果卡" onClick={() => setPendingReportCard(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="trip-result-facts">
              <span>{pendingReportCard.summary}</span>
              <span>可提取 {pendingReportCard.planCount} 条计划</span>
            </div>
            <div className="trip-result-actions">
              <button onClick={() => void downloadGeneratedReport()}><Download size={16} />下载报告</button>
              <button onClick={() => void confirmGeneratedReport(false)}><FileText size={16} />仅保存报告</button>
              <button className="primary" onClick={() => void confirmGeneratedReport(true)}>
                <CalendarPlus size={16} />保存并加入计划
              </button>
            </div>
          </section>
        )}

        {tripResultCard && (
          <section className="trip-result-card" aria-label="出差行动卡">
            <div className="trip-result-heading">
              <div><strong>{tripResultCard.title}</strong><span>{tripResultCard.subtitle}</span></div>
              <button className="icon-button" title="关闭行程卡" onClick={() => setTripResultCard(null)}><X size={16} /></button>
            </div>
            <div className="trip-result-facts">
              {tripResultCard.facts.slice(0, 3).map((fact) => <span key={fact}>{fact}</span>)}
            </div>
            <div className="trip-result-actions">
              <button onClick={() => void downloadTripCard()}><Download size={16} />下载</button>
              <button className="primary" onClick={() => void saveTripCardToPlan()} disabled={tripResultCard.savedToPlan}>
                <CalendarPlus size={16} />{tripResultCard.savedToPlan ? '已加入计划' : '加入计划'}
              </button>
            </div>
          </section>
        )}

        {(isThinking || pausedAgentRun) && (
          <section className="agent-run-controls" aria-live="polite">
            <div>
              <strong>{isThinking ? 'Agent 正在执行' : '任务已暂停'}</strong>
              <span>{isThinking ? '暂停或取消会在当前安全步骤结束后生效' : pausedAgentRun?.goal}</span>
            </div>
            <div className="agent-run-control-actions">
              {isThinking ? (
                <>
                  <button onClick={pauseAgentRun} title="保存当前进度并暂停">
                    <Pause aria-hidden="true" size={16} />暂停
                  </button>
                  <button className="danger" onClick={cancelAgentRun} title="取消本次任务">
                    <Square aria-hidden="true" size={15} />取消
                  </button>
                </>
              ) : (
                <>
                  <button className="primary" onClick={() => void resumeAgentRun()}>
                    <Play aria-hidden="true" size={16} />继续任务
                  </button>
                  <button className="danger" onClick={() => setPausedAgentRun(null)}>
                    <X aria-hidden="true" size={16} />放弃
                  </button>
                </>
              )}
            </div>
          </section>
        )}

        <ChatInput
          input={input}
          inputRef={inputRef}
          isThinking={isThinking}
          attachments={pendingAttachments.map((file) => ({
            id: file.id ?? 0,
            name: file.name,
          }))}
          onInputChange={setInput}
          onSend={sendMessage}
          onAddFiles={addFilesToComposer}
          onRemoveAttachment={removePendingAttachment}
        />
      </section>

      <div
        className={`resize-handle right-resize ${rightPanelCollapsed ? 'disabled' : ''}`}
        onMouseDown={(event) => !rightPanelCollapsed && startResizePanel('right', event)}
      />

      <aside className={`insight-panel ${rightPanelCollapsed ? 'collapsed' : ''}`}>
        <button
          className="panel-collapse-button right"
          onClick={() => setRightPanelCollapsed((currentValue) => !currentValue)}
          title={rightPanelCollapsed ? '展开右侧工作台' : '折叠右侧工作台'}
        >
          {rightPanelCollapsed ? <ChevronLeft aria-hidden="true" size={16} /> : <ChevronRight aria-hidden="true" size={16} />}
        </button>
        {!rightPanelCollapsed && (
          <>
        <h2>管家工作台</h2>

        <div className="insight-section status-card">
          <h3>当前状态</h3>
          <ul>
            <li>桌面连接：{isElectronReady ? '已连接' : '未连接'}</li>
            <li>当前模型：{activeProvider?.name ?? '加载中'}</li>
            <li>资料库：{knowledgeIndex.length} 份文件</li>
            <li>计划：{activePlans.length} 个进行中 / {finishedPlans.length} 个完成</li>
          </ul>
        </div>

        {mode === 'user' ? (
          renderUserWorkspacePanel()
        ) : (
          <>
            <div className="insight-section">
              <h3>开发者能力</h3>
              <ul>
                <li>模型 Provider 可配置</li>
                <li>Prompt Skill 可安装</li>
                <li>HTTP API Tool 可连接</li>
                <li>Tool Registry + 权限确认</li>
                <li>Agent Timeline 可观测</li>
                <li>Preload + IPC 安全桥</li>
              </ul>
            </div>
            <div className="insight-section">
              <h3>Skill Registry</h3>
              <div className="skill-list">
                {builtinSkillViews.map((skill) => (
                  <button
                    key={skill.id}
                    className="skill-card"
                    onClick={() => runSkill(skill.id)}
                    disabled={isThinking || !skill.enabled}
                  >
                    <span>{skill.displayName}</span>
                    <small>{skill.displayDescription}</small>
                  </button>
                ))}
                {platformConfig?.customSkills.filter((skill) => skill.enabled !== false).map((skill) => (
                  <button
                    key={skill.id}
                    className="skill-card"
                    onClick={() => runCustomSkill(skill)}
                    disabled={isThinking}
                  >
                    <span>{skill.name}</span>
                    <small>{skill.description}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="insight-section">
              <h3>Custom Tools</h3>
              {platformConfig?.customTools.length ? (
                <div className="skill-list">
                  {platformConfig.customTools.filter((tool) => tool.enabled !== false).map((tool) => (
                    <button
                      key={tool.id}
                      className="skill-card"
                      onClick={() => runCustomTool(tool)}
                      disabled={isThinking || !isElectronReady}
                    >
                      <span>{tool.name}</span>
                      <small>
                        {tool.method} {tool.endpoint}
                      </small>
                    </button>
                  ))}
                </div>
              ) : (
                <p>暂无自定义 Tool，可在设置里安装。</p>
              )}
            </div>
            <div className="insight-section">
              <h3>执行轨迹</h3>
              {agentTimeline.length === 0 ? (
                <p>发送需要工具的问题后，会显示规划、调用、观察和回复过程。</p>
              ) : (
                <div className="timeline-list">
                  {agentTimeline.map((step) => (
                    <div key={step.id} className={`timeline-item ${step.status}`}>
                      <div className="timeline-title">{step.title}</div>
                      <div className="timeline-detail">{step.detail}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="insight-section">
              <h3>工具调用日志</h3>
              {toolLogs.length === 0 ? (
                <p>暂无工具调用。试试输入“帮我看看当前电脑环境”。</p>
              ) : (
                <div className="tool-log-list">
                  {toolLogs.map((log) => (
                    <div key={log.id} className={`tool-log-item ${log.status}`}>
                      <div className="tool-log-name">{log.name}</div>
                      <div className="tool-log-detail">{log.detail}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
          </>
        )}
      </aside>

      {tripPlannerOpen && (
        <div className="settings-overlay trip-planner-overlay" role="presentation">
          <section className="settings-dialog trip-planner-dialog" role="dialog" aria-modal="true" aria-labelledby="trip-planner-title">
            <header>
              <div>
                <div className="eyebrow">Travel workflow</div>
                <h2 id="trip-planner-title">出差规划</h2>
              </div>
              <button onClick={() => setTripPlannerOpen(false)}>关闭</button>
            </header>
            <p className="settings-help">填写基本行程后，管家会查询天气和路线，并生成预算、报销清单与待办计划。</p>
            <div className="trip-form-grid">
              <label>出发地<input autoFocus value={tripDraft.origin ?? ''} placeholder="例如 北京"
                onChange={(event) => setTripDraft({ ...tripDraft, origin: event.target.value })} /></label>
              <label>目的地<input value={tripDraft.destination ?? ''} placeholder="例如 上海"
                onChange={(event) => setTripDraft({ ...tripDraft, destination: event.target.value })} /></label>
              <label>出发日期<input type="date" value={tripDraft.dateText ?? ''}
                onChange={(event) => setTripDraft({ ...tripDraft, dateText: event.target.value })} /></label>
              <label>住宿晚数<input type="number" min="0" max="30" value={tripDraft.nights ?? ''} placeholder="0"
                onChange={(event) => setTripDraft({ ...tripDraft, nights: event.target.value })} /></label>
              <label className="trip-purpose-field">出差目的<input value={tripDraft.purpose ?? ''} placeholder="例如 客户拜访、培训或会议"
                onChange={(event) => setTripDraft({ ...tripDraft, purpose: event.target.value })} /></label>
            </div>
            <div className="trip-form-actions">
              <button onClick={() => setTripPlannerOpen(false)}>取消</button>
              <button className="panel-action-button" onClick={() => void submitTripPlannerForm()}
                disabled={getMissingTripFields(tripDraft).length > 0 || isThinking}>开始规划</button>
            </div>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="settings-overlay">
          <section className="settings-dialog">
            <header>
              <div>
                <div className="eyebrow">Settings</div>
                <h2>{settingsPage === 'home' ? '设置中心' : '设置详情'}</h2>
              </div>
              <div className="settings-header-actions">
                {settingsPage !== 'home' && (
                  <button onClick={() => setSettingsPage('home')}>返回</button>
                )}
                <button onClick={() => setSettingsOpen(false)}>关闭</button>
              </div>
            </header>

            {settingsPage === 'home' && (
              <>
                <button className="settings-entry" onClick={() => setSettingsPage('provider')}>
                  <span>
                    <strong>模型服务</strong>
                    <small>选择当前模型，管理 API Key 和兼容接口。</small>
                  </span>
                  <b>{activeProvider?.name ?? '未加载'}</b>
                </button>
                <button className="settings-entry" onClick={() => setSettingsPage('extensions')}>
                  <span>
                    <strong>扩展能力</strong>
                    <small>安装和管理 Skill、Tool 与本地扩展包。</small>
                  </span>
                  <b>{(platformConfig?.customSkills.length ?? 0) + (platformConfig?.customTools.length ?? 0)} 个</b>
                </button>
                <button className="settings-entry" onClick={() => setSettingsPage('integrations')}>
                  <span>
                    <strong>外部服务</strong>
                    <small>配置天气、地点和路线等业务 API。</small>
                  </span>
                  <b>{platformConfig?.integrations.amapApiKey ? '已配置' : '待配置'}</b>
                </button>
                <button className="settings-entry" onClick={() => setSettingsPage('advanced')}>
                  <span>
                    <strong>高级设置</strong>
                    <small>RAG、Agent 运行、评测、指标和审计日志。</small>
                  </span>
                  <b>高级</b>
                </button>
                <button className="settings-entry" onClick={() => setSettingsPage('data')}>
                  <span>
                    <strong>数据与隐私</strong>
                    <small>导出本地备份、打开数据目录或清理工作数据。</small>
                  </span>
                  <b>本地</b>
                </button>
                <label className="settings-row">
                  <span>语音朗读</span>
                  <input
                    type="checkbox"
                    checked={voiceEnabled}
                    onChange={(event) => setVoiceEnabled(event.target.checked)}
                  />
                </label>
                <button
                  className="settings-row settings-action-row"
                  disabled={!isElectronReady}
                  onClick={async () => {
                    const nextValue = await window.electronAPI?.toggleAlwaysOnTop()
                    setAlwaysOnTop(Boolean(nextValue))
                  }}
                >
                  <span>窗口置顶</span>
                  <strong>{alwaysOnTop ? '已开启' : '未开启'}</strong>
                </button>
              </>
            )}

            {settingsPage === 'extensions' && (
              <div className="settings-block settings-category-grid">
                <h3>扩展能力</h3>
                <p className="settings-help">安装、查看和管理管家可以调用的 Skill 与 Tool。</p>
                <button className="settings-entry" onClick={() => setSettingsPage('installed')}>
                  <span><strong>已安装扩展</strong><small>查看、编辑、禁用或删除 Skill 和 Tool。</small></span>
                  <b>管理</b>
                </button>
                <button className="settings-entry" onClick={() => setSettingsPage('skill')}>
                  <span><strong>添加 Prompt Skill</strong><small>手动创建或从本地文件导入。</small></span>
                  <b>添加</b>
                </button>
                <button className="settings-entry" onClick={() => setSettingsPage('tool')}>
                  <span><strong>添加 HTTP API Tool</strong><small>连接天气、路线或其他外部服务。</small></span>
                  <b>添加</b>
                </button>
                <button className="settings-entry" onClick={openExtensionsFolder}>
                  <span><strong>扩展文件夹</strong><small>放入扩展包后由系统自动读取。</small></span>
                  <b>打开</b>
                </button>
              </div>
            )}

            {settingsPage === 'advanced' && (
              <div className="settings-block settings-category-grid">
                <h3>高级设置</h3>
                <p className="settings-help">面向调试、检索优化和 Agent 效果验证的技术选项。</p>
                <button className="settings-entry" onClick={() => setSettingsPage('rag')}>
                  <span><strong>RAG 检索</strong><small>Embedding、混合检索、Reranker 和上下文压缩。</small></span>
                  <b>{platformConfig?.rag.embeddingEnabled ? '混合' : 'BM25'}</b>
                </button>
                <button className="settings-entry" onClick={() => { setSettingsOpen(false); setWorkspacePage('runs') }}>
                  <span><strong>Agent 运行记录</strong><small>查看决策轮次、工具观察、暂停和失败原因。</small></span>
                  <b>{agentRuns.length} 次</b>
                </button>
                <button className="settings-entry" onClick={() => { setSettingsOpen(false); setWorkspacePage('metrics') }}>
                  <span><strong>Eval 与指标</strong><small>查看成功率、工具表现、RAG 模式和响应延迟。</small></span>
                  <b>Metrics</b>
                </button>
                <button className="settings-entry" onClick={() => { setSettingsOpen(false); void openAuditLogs() }}>
                  <span><strong>审计日志</strong><small>检查 Agent、工具、文件、配置和系统错误。</small></span>
                  <b>日志</b>
                </button>
              </div>
            )}

            {settingsPage === 'provider' && platformConfig && (
              <div className="settings-block">
                <h3>模型 Provider</h3>
                <p className="settings-help">选择当前使用的大模型，或添加一个兼容 Chat Completions 的新接口。</p>
                <select
                  value={platformConfig.activeProviderId}
                  onChange={(event) => setActiveProvider(event.target.value)}
                >
                  {platformConfig.providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name} / {provider.model}
                    </option>
                  ))}
                </select>
                <div className="settings-form">
                  <input
                    value={providerForm.name}
                    placeholder="Provider 名称，例如 DeepSeek"
                    onChange={(event) => setProviderForm({ ...providerForm, name: event.target.value })}
                  />
                  <select
                    value={providerForm.type}
                    onChange={(event) =>
                      setProviderForm({ ...providerForm, type: event.target.value as ProviderType })
                    }
                  >
                    <option value="openai-compatible">OpenAI Compatible</option>
                    <option value="zhipu">Zhipu</option>
                    <option value="mock">Mock</option>
                  </select>
                  <input
                    value={providerForm.model}
                    placeholder="模型名，例如 deepseek-chat / glm-4-flash"
                    onChange={(event) => setProviderForm({ ...providerForm, model: event.target.value })}
                  />
                  <input
                    value={providerForm.baseUrl}
                    placeholder="Chat Completions URL"
                    onChange={(event) => setProviderForm({ ...providerForm, baseUrl: event.target.value })}
                  />
                  <input
                    value={providerForm.apiKey}
                    placeholder="API Key"
                    type="password"
                    onChange={(event) => setProviderForm({ ...providerForm, apiKey: event.target.value })}
                  />
                  <button onClick={addModelProvider}>添加并启用 Provider</button>
                </div>
              </div>
            )}

            {settingsPage === 'integrations' && platformConfig && (
              <div className="settings-block">
                <h3>外部服务</h3>
                <p className="settings-help">Key 只保存在本机，并使用 Windows 凭据加密。高德需创建“Web 服务”类型 Key。</p>
                <div className="settings-form">
                  <label>
                    高德 Web 服务 Key
                    <input
                      type="password"
                      value={platformConfig.integrations.amapApiKey ?? ''}
                      placeholder="用于天气、地点解析和路线规划"
                      onChange={(event) => setPlatformConfig({
                        ...platformConfig,
                        integrations: { ...platformConfig.integrations, amapApiKey: event.target.value },
                      })}
                    />
                  </label>
                  <button onClick={() => void savePlatformConfig(platformConfig)}>保存外部服务配置</button>
                </div>
              </div>
            )}

            {settingsPage === 'rag' && platformConfig && (
              <div className="settings-block">
                <h3>RAG 检索引擎</h3>
                <p className="settings-help">
                  BM25 始终在本地可用。启用 Embedding 后，系统会并行执行关键词与向量检索，再进行混合评分、重排和上下文压缩。
                </p>
                <label className="settings-row">
                  <span>启用 Embedding 向量检索</span>
                  <input
                    type="checkbox"
                    checked={platformConfig.rag.embeddingEnabled}
                    onChange={(event) => setPlatformConfig({
                      ...platformConfig,
                      rag: { ...platformConfig.rag, embeddingEnabled: event.target.checked },
                    })}
                  />
                </label>
                <div className="settings-form">
                  <label>
                    Embedding 使用的 Provider
                    <select
                      value={platformConfig.rag.embeddingProviderId}
                      onChange={(event) => setPlatformConfig({
                        ...platformConfig,
                        rag: { ...platformConfig.rag, embeddingProviderId: event.target.value },
                      })}
                    >
                      {platformConfig.providers.filter((provider) => provider.type !== 'mock').map((provider) => (
                        <option key={provider.id} value={provider.id}>{provider.name}</option>
                      ))}
                    </select>
                  </label>
                  <input
                    value={platformConfig.rag.embeddingModel}
                    placeholder="Embedding 模型，例如 embedding-3"
                    onChange={(event) => setPlatformConfig({
                      ...platformConfig,
                      rag: { ...platformConfig.rag, embeddingModel: event.target.value },
                    })}
                  />
                  <input
                    value={platformConfig.rag.embeddingBaseUrl}
                    placeholder="兼容 /embeddings 的完整 URL"
                    onChange={(event) => setPlatformConfig({
                      ...platformConfig,
                      rag: { ...platformConfig.rag, embeddingBaseUrl: event.target.value },
                    })}
                  />
                  <label className="settings-row">
                    <span>启用模型级 Reranker</span>
                    <input
                      type="checkbox"
                      checked={platformConfig.rag.rerankerEnabled}
                      onChange={(event) => setPlatformConfig({
                        ...platformConfig,
                        rag: { ...platformConfig.rag, rerankerEnabled: event.target.checked },
                      })}
                    />
                  </label>
                  <input
                    value={platformConfig.rag.rerankerModel}
                    placeholder="重排模型，例如 rerank"
                    onChange={(event) => setPlatformConfig({
                      ...platformConfig,
                      rag: { ...platformConfig.rag, rerankerModel: event.target.value },
                    })}
                  />
                  <input
                    value={platformConfig.rag.rerankerBaseUrl}
                    placeholder="Reranker 完整 URL"
                    onChange={(event) => setPlatformConfig({
                      ...platformConfig,
                      rag: { ...platformConfig.rag, rerankerBaseUrl: event.target.value },
                    })}
                  />
                  <label>
                    最终交给大模型的片段数：{platformConfig.rag.topK}
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={platformConfig.rag.topK}
                      onChange={(event) => setPlatformConfig({
                        ...platformConfig,
                        rag: { ...platformConfig.rag, topK: Number(event.target.value) },
                      })}
                    />
                  </label>
                  <button onClick={saveRagSettings}>保存 RAG 配置</button>
                  <button onClick={rebuildRagIndex} disabled={!platformConfig.rag.embeddingEnabled || isThinking}>
                    重建全部向量索引
                  </button>
                  {ragStatus && <p className="settings-help">{ragStatus}</p>}
                </div>
              </div>
            )}

            {settingsPage === 'skill' && (
              <div className="settings-block">
                <h3>{editingSkillId ? '编辑 Prompt Skill' : '安装 Prompt Skill'}</h3>
                <p className="settings-help">可以手动填写，也可以从本地导入 json、md 或 txt，导入后会先填表。</p>
                <button className="import-config-button" onClick={importCustomSkillDraft}>
                  从本地导入 Skill 配置
                </button>
                <div className="settings-form">
                  <input
                    value={customSkillForm.name}
                    placeholder="Skill 名称，例如 资料分析"
                    onChange={(event) =>
                      setCustomSkillForm({ ...customSkillForm, name: event.target.value })
                    }
                  />
                  <input
                    value={customSkillForm.description}
                    placeholder="Skill 描述"
                    onChange={(event) =>
                      setCustomSkillForm({ ...customSkillForm, description: event.target.value })
                    }
                  />
                  <textarea
                    value={customSkillForm.prompt}
                    placeholder="Skill Prompt，例如：你是资料分析助手，请按摘要、结论、建议输出..."
                    onChange={(event) =>
                      setCustomSkillForm({ ...customSkillForm, prompt: event.target.value })
                    }
                  />
                  <button onClick={addCustomSkill}>{editingSkillId ? '保存 Skill' : '安装 Skill'}</button>
                </div>
              </div>
            )}

            {settingsPage === 'tool' && (
              <div className="settings-block">
                <h3>{editingToolId ? '编辑 HTTP API Tool' : '安装 HTTP API Tool'}</h3>
                <p className="settings-help">Tool 适合配置外部 API。描述要写清楚什么时候调用；Endpoint 支持 city 和 input 占位符，例如 {'{{city}}'}、{'{{input}}'}。出差规划会自动寻找描述里包含“天气、交通/高铁/航班、酒店/住宿”的 Tool。</p>
                <button className="import-config-button" onClick={importCustomToolDraft}>
                  从本地导入 Tool JSON
                </button>
                <div className="settings-form">
                  <input
                    value={customToolForm.name}
                    placeholder="Tool 名称，例如 数据接口查询"
                    onChange={(event) => setCustomToolForm({ ...customToolForm, name: event.target.value })}
                  />
                  <input
                    value={customToolForm.description}
                    placeholder="Tool 描述"
                    onChange={(event) =>
                      setCustomToolForm({ ...customToolForm, description: event.target.value })
                    }
                  />
                  <select
                    value={customToolForm.method}
                    onChange={(event) =>
                      setCustomToolForm({
                        ...customToolForm,
                        method: event.target.value as 'GET' | 'POST',
                      })
                    }
                  >
                    <option value="POST">POST</option>
                    <option value="GET">GET</option>
                  </select>
                  <input
                    value={customToolForm.endpoint}
                    placeholder="Endpoint URL，例如 https://api.example.com/weather?city={{city}}"
                    onChange={(event) =>
                      setCustomToolForm({ ...customToolForm, endpoint: event.target.value })
                    }
                  />
                  <input
                    value={customToolForm.apiKey}
                    placeholder="可选 API Key"
                    type="password"
                    onChange={(event) =>
                      setCustomToolForm({ ...customToolForm, apiKey: event.target.value })
                    }
                  />
                  <select
                    value={customToolForm.apiKeyPlacement}
                    onChange={(event) => setCustomToolForm({
                      ...customToolForm,
                      apiKeyPlacement: event.target.value as 'none' | 'bearer' | 'query' | 'header',
                    })}
                  >
                    <option value="none">无需鉴权</option>
                    <option value="bearer">Authorization Bearer</option>
                    <option value="query">URL 查询参数 / 模板</option>
                    <option value="header">自定义 Header</option>
                  </select>
                  <input
                    value={customToolForm.apiKeyName}
                    placeholder="Key 参数名，例如 key 或 X-API-Key"
                    onChange={(event) => setCustomToolForm({ ...customToolForm, apiKeyName: event.target.value })}
                  />
                  <details className="tool-advanced-config">
                    <summary>结构化参数与响应</summary>
                    <p className="settings-help">输入框支持 JSON。映射值填写输入字段名，或使用 {'{{field}}'} 模板。响应路径示例：data.items.0。</p>
                    <label>
                      Tool 版本
                      <input value={customToolForm.version} placeholder="1.0.0"
                        onChange={(event) => setCustomToolForm({ ...customToolForm, version: event.target.value })} />
                    </label>
                    <label>
                      Headers JSON
                      <textarea value={customToolForm.headersJson} placeholder={'{"X-App":"desktop","X-City":"{{city}}"}'}
                        onChange={(event) => setCustomToolForm({ ...customToolForm, headersJson: event.target.value })} />
                    </label>
                    <label>
                      输入 JSON Schema
                      <textarea value={customToolForm.inputSchemaJson} placeholder={'{"properties":{"city":{"type":"string"}},"required":["city"]}'}
                        onChange={(event) => setCustomToolForm({ ...customToolForm, inputSchemaJson: event.target.value })} />
                    </label>
                    <label>
                      Query 参数映射
                      <textarea value={customToolForm.queryParamsJson} placeholder={'{"city":"city","days":"days"}'}
                        onChange={(event) => setCustomToolForm({ ...customToolForm, queryParamsJson: event.target.value })} />
                    </label>
                    <label>
                      Body 参数映射
                      <textarea value={customToolForm.bodyParamsJson} placeholder={'{"location":"city","query":"input"}'}
                        onChange={(event) => setCustomToolForm({ ...customToolForm, bodyParamsJson: event.target.value })} />
                    </label>
                    <label>
                      响应提取路径
                      <input value={customToolForm.responsePath} placeholder="data.items"
                        onChange={(event) => setCustomToolForm({ ...customToolForm, responsePath: event.target.value })} />
                    </label>
                  </details>
                  <label>
                    超时（毫秒）
                    <input type="number" min="1000" max="60000" value={customToolForm.timeoutMs}
                      onChange={(event) => setCustomToolForm({ ...customToolForm, timeoutMs: Number(event.target.value) })} />
                  </label>
                  <label>
                    失败重试次数
                    <input type="number" min="0" max="3" value={customToolForm.retries}
                      onChange={(event) => setCustomToolForm({ ...customToolForm, retries: Number(event.target.value) })} />
                  </label>
                  <button onClick={addCustomTool}>{editingToolId ? '保存 Tool' : '安装 Tool'}</button>
                </div>
              </div>
            )}

            {settingsPage === 'data' && (
              <div className="settings-block data-privacy-panel">
                <h3>数据与隐私</h3>
                <p className="settings-help">报告、计划、行动、记忆、知识库、Agent 记录和审计日志默认保存在本机。导出的备份不会包含 API Key。</p>
                <div className="data-stat-grid">
                  <span><strong>{workflowData.reports.length}</strong><small>报告</small></span>
                  <span><strong>{workflowData.plans.length}</strong><small>计划</small></span>
                  <span><strong>{knowledgeIndex.length}</strong><small>资料</small></span>
                  <span><strong>{memoryNotes.length}</strong><small>记忆</small></span>
                </div>
                <button className="panel-action-button" onClick={exportUserData} disabled={!isElectronReady}>导出完整备份</button>
                <button className="panel-action-button" onClick={() => window.electronAPI.openDataFolder()} disabled={!isElectronReady}>打开本地数据目录</button>
                <div className="danger-zone">
                  <strong>危险操作</strong>
                  <p>清理后无法撤销，模型 Provider、Skill 和 Tool 配置会保留。</p>
                  <button onClick={clearUserData} disabled={!isElectronReady}>清理全部工作数据</button>
                </div>
              </div>
            )}

            {settingsPage === 'installed' && platformConfig && (
              <div className="settings-block">
                <h3>已安装 Skill / Tool</h3>
                <p className="settings-help">这里可以查看当前安装项，并进行编辑、禁用或删除。</p>
                <div className="installed-toolbar">
                  <button onClick={() => setSettingsPage('skill')}>添加 Skill</button>
                  <button onClick={() => setSettingsPage('tool')}>添加 Tool</button>
                  <button onClick={openExtensionsFolder}>打开扩展文件夹</button>
                  <button onClick={refreshPlatformConfig}>重新扫描</button>
                  <button onClick={restoreBuiltinItems}>恢复内置项</button>
                </div>
                {extensionsPath && <p className="settings-help">扩展目录：{extensionsPath}</p>}
                <div className="installed-list">
                  <h4>内置 Skill</h4>
                  {builtinSkillViews.map((skill) => (
                    <div key={skill.id} className="installed-item builtin">
                      <div>
                        <strong>{skill.displayName}</strong>
                        <small>内置 Skill · {skill.enabled ? '已启用' : '已禁用'}</small>
                        <p>{skill.displayDescription}</p>
                      </div>
                      <div className="installed-actions">
                        <details className="action-menu">
                          <summary>操作</summary>
                          <div>
                            <button onClick={() => viewBuiltinSkill(skill)}>查看</button>
                            <button onClick={() => editBuiltinSkill(skill)}>编辑</button>
                            <button onClick={() => toggleBuiltinSkill(skill.id)}>
                              {skill.enabled ? '禁用' : '启用'}
                            </button>
                            <button onClick={() => deleteBuiltinSkill(skill.id)}>删除</button>
                          </div>
                        </details>
                      </div>
                    </div>
                  ))}

                  <h4>内置 Tool</h4>
                  {builtinToolViews.map((tool) => (
                    <div key={tool.name} className="installed-item builtin">
                      <div>
                        <strong>{tool.displayName}</strong>
                        <small>
                          内置 Tool · {tool.enabled ? '已启用' : '已禁用'} · {tool.riskLevel} 风险
                        </small>
                        <p>{tool.displayDescription}</p>
                      </div>
                      <div className="installed-actions">
                        <details className="action-menu">
                          <summary>操作</summary>
                          <div>
                            <button onClick={() => viewBuiltinTool(tool)}>查看</button>
                            <button onClick={() => editBuiltinTool(tool)}>编辑</button>
                            <button onClick={() => toggleBuiltinTool(tool.name)}>
                              {tool.enabled ? '禁用' : '启用'}
                            </button>
                            <button onClick={() => deleteBuiltinTool(tool.name)}>删除</button>
                          </div>
                        </details>
                      </div>
                    </div>
                  ))}

                  <h4>自定义 Skill</h4>
                  {platformConfig.customSkills.map((skill) => (
                    <div key={skill.id} className="installed-item">
                      <div>
                        <strong>{skill.name}</strong>
                        <small>
                          {skill.source === 'extension' ? '扩展 Skill' : '自定义 Skill'} ·{' '}
                          {skill.enabled === false ? '已禁用' : '已启用'}
                        </small>
                        <p>{skill.description}</p>
                      </div>
                      <div className="installed-actions">
                        <details className="action-menu">
                          <summary>操作</summary>
                          <div>
                            <button onClick={() => runCustomSkill(skill)} disabled={isThinking}>
                              运行
                            </button>
                            <button
                              onClick={() =>
                                window.alert(
                                  `自定义 Skill：${skill.name}\n\n描述：${skill.description}\n\nPrompt：\n${skill.prompt}`,
                                )
                              }
                            >
                              查看
                            </button>
                            <button onClick={() => editCustomSkill(skill)}>编辑</button>
                            <button onClick={() => toggleCustomSkill(skill.id)}>
                              {skill.enabled === false ? '启用' : '禁用'}
                            </button>
                            <button onClick={() => deleteCustomSkill(skill.id)}>删除</button>
                          </div>
                        </details>
                      </div>
                    </div>
                  ))}

                  <h4>自定义 Tool</h4>
                  {platformConfig.customTools.map((tool) => (
                    <div key={tool.id} className="installed-item">
                      <div>
                        <strong>{tool.name}</strong>
                        <small>
                          {tool.source === 'extension' ? '扩展 Tool' : '自定义 Tool'} ·{' '}
                          {tool.enabled === false ? '已禁用' : '已启用'}
                        </small>
                        <p>{tool.description || tool.endpoint}</p>
                      </div>
                      <div className="installed-actions">
                        <details className="action-menu">
                          <summary>操作</summary>
                          <div>
                            <button onClick={() => runCustomTool(tool)} disabled={isThinking || !isElectronReady}>
                              运行
                            </button>
                            <button
                              onClick={() =>
                                window.alert(
                                  `自定义 Tool：${tool.name}\n\n描述：${tool.description}\n\n方法：${tool.method}\nEndpoint：${tool.endpoint}`,
                                )
                              }
                            >
                              查看
                            </button>
                            <button onClick={() => editCustomTool(tool)}>编辑</button>
                            <button onClick={() => toggleCustomTool(tool.id)}>
                              {tool.enabled === false ? '启用' : '禁用'}
                            </button>
                            <button onClick={() => deleteCustomTool(tool.id)}>删除</button>
                          </div>
                        </details>
                      </div>
                    </div>
                  ))}
                  {platformConfig.customSkills.length === 0 && platformConfig.customTools.length === 0 && (
                    <p>暂时还没有安装自定义 Skill 或 Tool，但上面的内置能力已经可用。</p>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  )
}

export default App
