import { useEffect, useRef, useState } from 'react'
import './App.css'
import AvatarPanel from './components/AvatarPanel'
import ChatInput from './components/ChatInput'
import MessageList from './components/MessageList'
import { createAssistantReply } from './services/assistant'
import {
  runAgent,
  type AgentTimelineStep,
  type KnowledgeDocument,
  type ToolCallLog,
} from './services/agent'
import { toolRegistry } from './agent/toolRegistry'
import { getSkillDefinition, skillRegistry, type SkillId } from './skills/skillRegistry'
import type { AssistantStatus, Message } from './type'

type ProductMode = 'user' | 'developer'
type PendingFileReadStep = 'awaitingConsent' | 'awaitingScope' | null
type PendingTripStep = 'awaitingDetails' | null
type SettingsPage = 'home' | 'provider' | 'skill' | 'tool' | 'installed'
type WorkspacePage = 'home' | 'data' | 'reports' | 'plans' | 'activity' | 'memory'
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
  enabled?: boolean
  source?: 'manual' | 'extension'
}

type AgentPlatformConfig = {
  activeProviderId: string
  providers: ModelProviderConfig[]
  customSkills: CustomSkillConfig[]
  customTools: CustomToolConfig[]
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

type BuiltinOverride = {
  name?: string
  description?: string
  enabled?: boolean
  deleted?: boolean
}

type BuiltinOverrideMap = Record<string, BuiltinOverride>

function createMessageId() {
  return Date.now() + Math.random()
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

function extractTripDraft(text: string): TripDraft {
  const destinationMatch =
    text.match(/去([^，。,.?\s]{2,12})(?:出差|开会|拜访|培训|参会)?/) ??
    text.match(/到([^，。,.?\s]{2,12})(?:出差|开会|拜访|培训|参会)?/)
  const originMatch = text.match(/从([^，。,.?\s]{2,12})(?:出发|去|到)/)
  const dateMatch = text.match(/(今天|明天|后天|下周[一二三四五六日天]?|\d{1,2}月\d{1,2}[日号]?|\d{4}-\d{1,2}-\d{1,2})/)
  const nightsMatch = text.match(/住(\d+)晚|(\d+)晚|当天来回/)
  const purposeMatch = text.match(/(?:为了|去|参加|拜访|开)([^，。,.?\s]{2,18})(?:出差|会议|客户|培训)?/)

  return {
    origin: originMatch?.[1],
    destination: destinationMatch?.[1],
    dateText: dateMatch?.[1],
    nights: nightsMatch?.[1] ?? nightsMatch?.[2] ?? (text.includes('当天来回') ? '0' : undefined),
    purpose: purposeMatch?.[1],
  }
}

function mergeTripDraft(currentDraft: TripDraft, nextDraft: TripDraft) {
  return {
    origin: nextDraft.origin ?? currentDraft.origin,
    destination: nextDraft.destination ?? currentDraft.destination,
    dateText: nextDraft.dateText ?? currentDraft.dateText,
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
    return tool.enabled !== false && keywords[kind].test(target)
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
  const [mode, setMode] = useState<ProductMode>(() => {
    return (localStorage.getItem('ai-butler:mode') as ProductMode | null) ?? 'user'
  })
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
  const [memoryNotes, setMemoryNotes] = useState<string[]>(() =>
    readJsonFromStorage('ai-butler:memoryNotes', []),
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
  const [pendingFileReadStep, setPendingFileReadStep] = useState<PendingFileReadStep>(null)
  const [pendingTripStep, setPendingTripStep] = useState<PendingTripStep>(null)
  const [tripDraft, setTripDraft] = useState<TripDraft>({})
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [platformConfig, setPlatformConfig] = useState<AgentPlatformConfig | null>(null)
  const [workflowData, setWorkflowData] = useState<ButlerWorkspaceData>({
    reports: [],
    plans: [],
    activities: [],
  })
  const [extensionsPath, setExtensionsPath] = useState('')
  const [planForm, setPlanForm] = useState({
    title: '',
    description: '',
  })
  const [progressDraft, setProgressDraft] = useState({
    planId: '',
    note: '',
    completion: '50',
    blocker: '',
  })
  const [activityNote, setActivityNote] = useState('')
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
    localStorage.setItem('ai-butler:mode', mode)
  }, [mode])

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
  }, [isElectronReady])

  useEffect(() => {
    if (!isThinking) {
      inputRef.current?.focus()
    }
  }, [isThinking])

  useEffect(() => {
    localStorage.setItem('ai-butler:knowledgeDocuments', JSON.stringify(knowledgeDocuments))
  }, [knowledgeDocuments])

  useEffect(() => {
    localStorage.setItem('ai-butler:memoryNotes', JSON.stringify(memoryNotes))
  }, [memoryNotes])

  useEffect(() => {
    localStorage.setItem('ai-butler:builtinSkillOverrides', JSON.stringify(builtinSkillOverrides))
  }, [builtinSkillOverrides])

  useEffect(() => {
    localStorage.setItem('ai-butler:builtinToolOverrides', JSON.stringify(builtinToolOverrides))
  }, [builtinToolOverrides])

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
        (plan) =>
          plan.status === 'active' &&
          plan.reminderTime &&
          plan.reminderTime <= currentTime &&
          plan.lastReminderDate !== todayKey,
      )

      if (!duePlan) {
        return
      }

      await window.electronAPI.notify('桌面 AI 管家提醒', `该推进计划了：${duePlan.title}`)
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
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 300))
    utterance.lang = 'zh-CN'
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

  async function saveGeneratedReport(content: string, source: string): Promise<SavedReportResult | null> {
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

    const planDrafts = extractPlanDraftsFromReport(content)
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
位置：右侧「报告悬浮窗」模块

2. 已提取计划
${planLines}

3. 下一步你可以做
- 点右侧「悬浮到桌面」，把报告放到桌面上
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
      await saveGeneratedReport(reply.content, '最近对话')
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
    })
    setWorkflowData(nextData)
    setPlanForm({ title: '', description: '' })
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

  async function invokeOptionalTripTool(tool: CustomToolConfig | undefined, input: string) {
    if (!tool) {
      return '未配置对应 API Tool。'
    }

    try {
      const result = await window.electronAPI.invokeCustomTool(tool.id, input)
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
    const enabledTools = platformConfig?.customTools.filter((tool) => tool.enabled !== false) ?? []
    const weatherTool = findTripTool(enabledTools, 'weather')
    const transportTool = findTripTool(enabledTools, 'transport')
    const hotelTool = findTripTool(enabledTools, 'hotel')
    const tripInput = `从${draft.origin}去${draft.destination}，时间${draft.dateText}，住${draft.nights}晚，目的：${draft.purpose ?? '普通出差'}`

    addTimelineStep({
      id: createMessageId(),
      title: '出差规划',
      detail: tripInput,
      status: 'success',
      createdAt: Date.now(),
    })

    const [weatherResult, transportResult, hotelResult] = await Promise.all([
      invokeOptionalTripTool(weatherTool, `${draft.destination} ${draft.dateText} 天气`),
      invokeOptionalTripTool(transportTool, `${draft.origin} 到 ${draft.destination} ${draft.dateText} 交通 高铁 飞机 比价`),
      invokeOptionalTripTool(hotelTool, `${draft.destination} ${draft.dateText} 住宿 ${draft.nights}晚 酒店 预算`),
    ])

    const historyContext = workflowData.reports
      .filter((report) => /出差|差旅|报销|交通|酒店/.test(report.content))
      .slice(0, 3)
      .map((report) => `# ${report.title}\n${report.content.slice(0, 1200)}`)
      .join('\n\n') || '暂无历史出差报告。'

    const reply = await createAssistantReply(
      `你是桌面 AI 管家的出差规划 Agent。请基于用户出差需求、历史出差记录和可用 API 结果，生成一份可执行出差计划。

用户需求：
${tripInput}

天气 API 结果：
${weatherResult}

交通 API 结果：
${transportResult}

酒店 API 结果：
${hotelResult}

历史出差记录：
${historyContext}

请输出：
1. 出差摘要
2. 交通建议：比较高铁/飞机/其他交通的成本、时间和风险；如果 API 缺失，要说明需要配置交通 Tool
3. 天气与携带建议：如果 API 缺失，要说明需要配置天气 Tool
4. 住宿与预算建议：如果 API 缺失，要说明需要配置酒店 Tool
5. 报销材料清单
6. 自动生成的待办计划
7. 出差后需要记录的数据，用来优化下次出差`,
    )

    await streamAssistantMessage(reply.content)
    const savedResult = await saveGeneratedReport(reply.content, `${draft.destination ?? '出差'}规划`)
    await streamAssistantMessage(createWorkflowDoneMessage(savedResult))
    setTripDraft({})
    setPendingTripStep(null)
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

      const modeHint =
        mode === 'user'
          ? '当前是普通用户版，请优先用通俗表达帮助用户整理资料、分析文件、生成报告。'
          : '当前是开发者模式，可以解释 Agent、Provider、Skill、Tool、RAG、IPC 等技术细节。'
      const memoryContext =
        memoryNotes.length > 0 ? `\n\n用户长期记忆：\n${memoryNotes.join('\n')}` : ''
      let streamedMessageId: number | null = null
      let streamedContent = ''
      const assistantReply = await runAgent(text, addToolLog, {
        knowledgeDocuments,
        customTools: enabledCustomTools,
        context: `${modeHint}${memoryContext}`,
        onTimeline: addTimelineStep,
        requestPermission: requestToolPermission,
        onRunComplete: (run) => window.electronAPI.saveAgentRun(run),
        onAssistantDelta: (delta) => {
          streamedContent += delta
          if (streamedMessageId === null) {
            streamedMessageId = createMessageId()
            setMessages((currentMessages) => [
              ...currentMessages,
              {
                id: streamedMessageId!,
                role: 'assistant',
                content: streamedContent,
                createdAt: Date.now(),
              },
            ])
            return
          }

          const targetMessageId = streamedMessageId
          setMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.id === targetMessageId ? { ...message, content: streamedContent } : message,
            ),
          )
        },
      })
      if (streamedMessageId === null) {
        await streamAssistantMessage(assistantReply.content)
      } else {
        const targetMessageId = streamedMessageId
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === targetMessageId ? { ...message, content: assistantReply.content } : message,
          ),
        )
        speak(assistantReply.content)
      }
    } catch {
      const errorMessage: Message = {
        id: createMessageId(),
        role: 'assistant',
        content: 'AI 服务暂时不可用。请检查 API Key、网络、模型配置或 Electron 主进程日志。',
        createdAt: Date.now(),
      }

      setMessages((currentMessages) => [...currentMessages, errorMessage])
    } finally {
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

文件名：${pickedFile!.name}

文件内容：
${pickedFile!.content}`
          : `请用开发者视角分析这个文件，输出：\n1. 文件职责\n2. 关键逻辑\n3. 风险或改进点\n4. 可以怎么写进项目介绍\n\n文件名：${pickedFile!.name}\n\n文件内容：\n${pickedFile!.content}`
      const assistantReply = await createAssistantReply(prompt)
      await streamAssistantMessage(assistantReply.content)
      const savedResult = await saveGeneratedReport(assistantReply.content, pickedFile.name)
      await streamAssistantMessage(createWorkflowDoneMessage(savedResult))
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

      const fileContext = files
        .map((file, index) => `# 文件 ${index + 1}: ${file.name}\n${file.content.slice(0, 3000)}`)
        .join('\n\n')
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
      const savedResult = await saveGeneratedReport(assistantReply.content, `文件夹：${files.length} 个文件`)
      await streamAssistantMessage(createWorkflowDoneMessage(savedResult))
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

    try {
      const fileContext = files
        .map((file, index) => `# 附件 ${index + 1}: ${file.name}\n${file.content.slice(0, 4000)}`)
        .join('\n\n')
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
      const savedResult = await saveGeneratedReport(
        assistantReply.content,
        files.length === 1 ? files[0].name : `${files.length} 个附件`,
      )
      await streamAssistantMessage(createWorkflowDoneMessage(savedResult))
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

    setKnowledgeDocuments((currentDocuments) => [document, ...currentDocuments].slice(0, 12))
    addToolLog({
      id: createMessageId(),
      name: 'rag.importDocument',
      status: 'success',
      detail: pickedFile!.name,
      createdAt: Date.now(),
    })
  }

  function rememberCurrentGoal() {
    const note = input.trim()
    if (!note) {
      return
    }

    setMemoryNotes((currentNotes) => [note, ...currentNotes].slice(0, 8))
    setInput('')
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

    const customTool: CustomToolConfig = {
      id: editingToolId ?? createLocalId('tool'),
      name: customToolForm.name.trim(),
      description: customToolForm.description.trim() || '用户安装的自定义 HTTP Tool',
      endpoint: customToolForm.endpoint.trim(),
      method: customToolForm.method,
      apiKey: customToolForm.apiKey.trim() || undefined,
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
        memoryNotes,
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
      setInput('我下周三要从北京去上海出差，住 1 晚，目的：客户拜访。帮我规划交通、天气、住宿、预算和报销清单。')
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
          <b>{knowledgeDocuments.length} 份</b>
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
            <small>查看报告，并悬浮到桌面。</small>
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

    if (workspacePage === 'reports') {
      return (
        <div className="insight-section">
          <h3>报告行动中心</h3>
          {latestReport ? (
            <div className="report-card">
              <strong>{latestReport.title}</strong>
              <p>{latestReport.summary}</p>
              <button className="panel-action-button" onClick={() => openFloatingReport(latestReport.id)} disabled={!isElectronReady}>
                悬浮到桌面
              </button>
              <small>报告会以置顶小窗显示，方便你边工作边看结论和计划。</small>
            </div>
          ) : (
            <p>还没有报告。分析文件后，我会自动保存报告并提取计划。</p>
          )}
          <div className="compact-list">
            {workflowData.reports.slice(1, 8).map((report) => (
              <button key={report.id} onClick={() => openFloatingReport(report.id)}>
                {report.title}
              </button>
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
                  <strong>{plan.title}</strong>
                  <small>
                    记录 {plan.checkins} 次 · 最近 {formatShortTime(plan.lastCheckinAt)}
                    {plan.reminderTime ? ` · 每天 ${plan.reminderTime} 提醒` : ''}
                  </small>
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
                  <div className="plan-actions">
                    <button onClick={() => startProgressRecord(plan)} disabled={plan.status === 'done'}>
                      记录进度
                    </button>
                    <button onClick={() => togglePlanDone(plan)}>
                      {plan.status === 'done' ? '继续' : '完成'}
                    </button>
                    <button onClick={() => deletePlan(plan.id)}>删除</button>
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
                  <strong>{activity.text}</strong>
                  <small>{new Date(activity.createdAt).toLocaleString('zh-CN')}</small>
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
        <p>已保存 {memoryNotes.length} 条偏好或目标。输入内容后点击保存。</p>
        <button className="panel-action-button" onClick={rememberCurrentGoal}>
          保存当前输入
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
      className={`app-shell ${mode === 'developer' ? 'developer-mode' : 'user-mode'} ${isDraggingFile ? 'dragging-file' : ''}`}
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
          {leftPanelCollapsed ? '>' : '<'}
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
            <p>
              {mode === 'user'
                ? '把资料、行程、计划和工具串起来，让事情更省心'
                : 'Provider / Skill / Tool / RAG / Agent Timeline'}
            </p>
          </div>
          <div className="header-actions">
            <div className="mode-switch" aria-label="版本切换">
              <button className={mode === 'user' ? 'active' : ''} onClick={() => setMode('user')}>
                普通版
              </button>
              <button
                className={mode === 'developer' ? 'active' : ''}
                onClick={() => setMode('developer')}
              >
                开发者版
              </button>
            </div>
            <button className="settings-button" onClick={() => setSettingsOpen(true)}>
              设置
            </button>
          </div>
        </header>

        <section className="quick-start">
          <button onClick={() => startButlerScenario('file')} disabled={isThinking || !isElectronReady}>
            <strong>文件变行动</strong>
            <span>分析资料，生成报告、计划和今日任务</span>
          </button>
          <button onClick={() => startButlerScenario('trip')}>
            <strong>出差规划</strong>
            <span>交通、天气、酒店、预算和报销清单</span>
          </button>
          <button onClick={() => startButlerScenario('expense')}>
            <strong>报销整理</strong>
            <span>找异常、缺票、超预算并持续跟踪</span>
          </button>
          <button onClick={() => startButlerScenario(mode === 'user' ? 'today' : 'workReport')}>
            <strong>{mode === 'user' ? '今日任务' : '工作汇报'}</strong>
            <span>{mode === 'user' ? '提醒、进度复盘和停滞拆解' : '根据记录生成汇报'}</span>
          </button>
        </section>

        <MessageList messages={messages} />

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
          {rightPanelCollapsed ? '<' : '>'}
        </button>
        {!rightPanelCollapsed && (
          <>
        <h2>{mode === 'user' ? '管家工作台' : '开发者控制台'}</h2>

        <div className="insight-section status-card">
          <h3>当前状态</h3>
          <ul>
            <li>桌面连接：{isElectronReady ? '已连接' : '未连接'}</li>
            <li>当前模型：{activeProvider?.name ?? '加载中'}</li>
            <li>资料库：{knowledgeDocuments.length} 份文件</li>
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
                    <strong>模型 Provider</strong>
                    <small>切换大模型，添加 OpenAI Compatible / 智谱接口。</small>
                  </span>
                  <b>{activeProvider?.name ?? '未加载'}</b>
                </button>
                <button className="settings-entry" onClick={() => setSettingsPage('skill')}>
                  <span>
                    <strong>安装 Prompt Skill</strong>
                    <small>手动创建或从本地导入 Skill 配置。</small>
                  </span>
                  <b>{platformConfig?.customSkills.length ?? 0} 个</b>
                </button>
                <button className="settings-entry" onClick={() => setSettingsPage('tool')}>
                  <span>
                    <strong>安装 HTTP API Tool</strong>
                    <small>连接外部 API，让 Agent 调用工具。</small>
                  </span>
                  <b>{platformConfig?.customTools.length ?? 0} 个</b>
                </button>
                <button className="settings-entry" onClick={() => setSettingsPage('installed')}>
                  <span>
                    <strong>已安装管理</strong>
                    <small>查看、编辑、禁用或删除已安装的 Skill 和 Tool。</small>
                  </span>
                  <b>管理</b>
                </button>
                <button className="settings-entry" onClick={openExtensionsFolder}>
                  <span>
                    <strong>扩展文件夹</strong>
                    <small>把 Skill / Tool 扩展包放到这里，系统会自动读取。</small>
                  </span>
                  <b>打开</b>
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
                  <button onClick={addCustomTool}>{editingToolId ? '保存 Tool' : '安装 Tool'}</button>
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
