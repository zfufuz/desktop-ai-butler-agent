// React 渲染层的 Electron API 类型契约，必须与 preload 暴露的方法保持一致。
import type { ScheduledAgentJob, ScheduledAgentJobDraft } from './automation/types'
import type { McpServerConfig, McpServerDraft } from './mcp/types'
export {}

type SystemInfo = {
  platform: string
  arch: string
  cpus: number
}

type BackendServiceStatus = {
  state: 'starting' | 'ready' | 'degraded' | 'stopped'
  detail: string
  port?: number
  pid?: number
  version?: string
  framework?: string
  agentFramework?: string
  orchestration?: string
}

type BackendDiagnosticResult = {
  run_id: string
  intent: string
  response: string
  steps: string[]
}

type AssistantReply = {
  content: string
}

type PickedTextFile = {
  name: string
  path: string
  content: string
}

type ProviderType = 'mock' | 'zhipu' | 'openai-compatible'

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

type CustomToolResult = {
  name: string
  content: string
}

type TripApiResult = {
  origin: string
  destination: string
  dateText: string
  weather: null | { date: string; dayWeather: string; nightWeather: string; dayTemp: string; nightTemp: string; dayWind: string }
  route: null | { distanceMeters: number; durationSeconds: number; tolls: number }
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

type ScheduleEvent = {
  id: string
  planId?: string
  title: string
  description: string
  date: string
  start: string
  end: string
  category: 'focus' | 'meeting' | 'life' | 'deadline'
  priority: 'low' | 'medium' | 'high'
  flexible: boolean
  progress: number
  status: 'active' | 'done'
  recurrence: 'none' | 'daily' | 'weekly'
  nextAction?: string
  createdAt: number
  updatedAt: number
}

type AgentRunSnapshot = {
  id: string
  goal: string
  status: 'queued' | 'running' | 'paused' | 'cancelled' | 'completed' | 'blocked' | 'failed'
  turns: number
  startedAt: number
  finishedAt?: number
  observations: unknown[]
  final?: string
  error?: string
}

type AuditLogLevel = 'info' | 'warn' | 'error'
type AuditLogStatus = 'success' | 'failure' | 'pending'
type AuditLogCategory = 'system' | 'agent' | 'tool' | 'file' | 'knowledge' | 'workflow' | 'security'

type AuditLogFilters = {
  level?: AuditLogLevel | 'all'
  category?: AuditLogCategory | 'all'
  status?: AuditLogStatus | 'all'
  query?: string
  limit?: number
}

type AuditLogEntry = {
  id: string
  createdAt: number
  level: AuditLogLevel
  category: AuditLogCategory
  action: string
  summary: string
  detail?: string
  status: AuditLogStatus
  runId?: string
  durationMs?: number
  metadata: Record<string, unknown>
}

type KnowledgeDocumentInput = {
  id: string | number
  name: string
  content: string
  createdAt: number
}

type KnowledgeSearchResult = {
  documentId: string
  documentName: string
  chunkIndex: number
  content: string
  score: number
  lexicalScore: number
  semanticScore: number
  retrievalMode: 'keyword' | 'hybrid'
}

type KnowledgeDocumentSummary = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  chunkCount: number
  characterCount: number
  embeddingCount: number
}

type MemoryNote = {
  id: string
  text: string
  category: 'preference' | 'goal' | 'context' | 'fact'
  pinned: boolean
  expiresAt?: number
  createdAt: number
  updatedAt: number
}

type ConversationMessage = {
  id: number
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

type ConversationSummary = {
  id: string
  title: string
  messageCount: number
  createdAt: number
  updatedAt: number
}

declare global {
  interface Window {
    electronAPI: {
      isElectron: boolean
      getAppName: () => string
      getAppVersion: () => Promise<string>
      getSystemInfo: () => Promise<SystemInfo>
      getBackendStatus: () => Promise<BackendServiceStatus>
      restartBackend: () => Promise<BackendServiceStatus>
      diagnoseBackend: (message: string) => Promise<BackendDiagnosticResult>
      sendChatMessage: (message: string) => Promise<AssistantReply>
      streamChatMessage: (
        message: string,
        onDelta: (delta: string) => void,
      ) => Promise<AssistantReply>
      pickTextFile: () => Promise<PickedTextFile | null>
      pickTextFiles: () => Promise<PickedTextFile[]>
      pickTextDirectory: () => Promise<PickedTextFile[]>
      getPathForFile: (file: File) => string
      readDroppedFile: (filePath: string) => Promise<PickedTextFile | null>
      readNamedTextFile: (query: string) => Promise<PickedTextFile | null>
      toggleAlwaysOnTop: () => Promise<boolean>
      getPlatformConfig: () => Promise<AgentPlatformConfig>
      savePlatformConfig: (config: AgentPlatformConfig) => Promise<AgentPlatformConfig>
      getWorkflowData: () => Promise<ButlerWorkspaceData>
      getAgentRuns: () => Promise<AgentRunSnapshot[]>
      saveAgentRun: (run: AgentRunSnapshot) => Promise<AgentRunSnapshot>
      getAuditLogs: (filters?: AuditLogFilters) => Promise<AuditLogEntry[]>
      exportAuditLogs: (filters?: AuditLogFilters) => Promise<{ exported: boolean; path?: string; count?: number }>
      clearAuditLogs: () => Promise<{ deleted: number }>
      exportUserData: () => Promise<{ exported: boolean; path?: string }>
      clearUserData: () => Promise<{ cleared: boolean }>
      openDataFolder: () => Promise<string>
      syncKnowledgeDocuments: (
        documents: KnowledgeDocumentInput[],
      ) => Promise<Array<{ id: string; name: string; createdAt: number; chunkCount: number }>>
      getKnowledgeDocuments: () => Promise<KnowledgeDocumentSummary[]>
      upsertKnowledgeDocument: (
        document: KnowledgeDocumentInput,
      ) => Promise<{ id: string; name: string; createdAt: number; chunkCount: number }>
      searchKnowledge: (query: string, limit?: number) => Promise<KnowledgeSearchResult[]>
      rebuildKnowledgeEmbeddings: () => Promise<{ documents: number; embeddings: number; model: string }>
      deleteKnowledgeDocument: (documentId: string) => Promise<{ deleted: boolean; id: string }>
      getMemoryNotes: () => Promise<MemoryNote[]>
      syncMemoryNotes: (notes: string[]) => Promise<MemoryNote[]>
      addMemoryNote: (text: string, category?: MemoryNote['category'], expiresAt?: number) => Promise<MemoryNote[]>
      updateMemoryNote: (noteId: string, patch: Partial<Pick<MemoryNote, 'text' | 'category' | 'pinned' | 'expiresAt'>>) => Promise<MemoryNote[]>
      deleteMemoryNote: (noteId: string) => Promise<MemoryNote[]>
      getConversations: () => Promise<ConversationSummary[]>
      createConversation: () => Promise<ConversationSummary>
      loadConversation: (conversationId: string) => Promise<{ conversation: ConversationSummary; messages: ConversationMessage[] }>
      saveConversation: (conversationId: string, messages: ConversationMessage[]) => Promise<ConversationSummary[]>
      deleteConversation: (conversationId: string) => Promise<{ deleted: boolean; id: string }>
      saveReport: (report: Omit<ButlerReport, 'id' | 'createdAt'>) => Promise<ButlerWorkspaceData>
      deleteReport: (reportId: string) => Promise<ButlerWorkspaceData>
      savePlan: (
        plan: Pick<ButlerPlan, 'title' | 'description'> & Partial<Pick<ButlerPlan, 'priority' | 'dueDate' | 'recurrence' | 'progress' | 'nextAction' | 'reminderTime'>>,
      ) => Promise<ButlerWorkspaceData>
      updatePlan: (planId: string, patch: Partial<ButlerPlan>) => Promise<ButlerWorkspaceData>
      deletePlan: (planId: string) => Promise<ButlerWorkspaceData>
      getScheduleEvents: (startDate?: string, endDate?: string) => Promise<ScheduleEvent[]>
      saveScheduleEvent: (scheduleEvent: Partial<ScheduleEvent> & Pick<ScheduleEvent, 'title' | 'date' | 'start' | 'end'>) => Promise<ScheduleEvent>
      deleteScheduleEvent: (eventId: string) => Promise<{ deleted: boolean; id: string }>
      getScheduledAgentJobs: () => Promise<ScheduledAgentJob[]>
      saveScheduledAgentJob: (job: ScheduledAgentJobDraft | ScheduledAgentJob) => Promise<ScheduledAgentJob>
      deleteScheduledAgentJob: (jobId: string) => Promise<{ deleted: boolean; id: string }>
      claimDueScheduledAgentJob: () => Promise<ScheduledAgentJob | null>
      claimScheduledAgentJobNow: (jobId: string) => Promise<ScheduledAgentJob | null>
      completeScheduledAgentJob: (jobId: string, success: boolean, result?: string) => Promise<ScheduledAgentJob | undefined>
      getMcpServers: () => Promise<McpServerConfig[]>
      saveMcpServer: (server: McpServerDraft | McpServerConfig) => Promise<McpServerConfig>
      deleteMcpServer: (serverId: string) => Promise<{ deleted: boolean; id: string }>
      discoverMcpServer: (serverId: string) => Promise<McpServerConfig>
      invokeMcpTool: (serverId: string, toolName: string, input: Record<string, unknown>) => Promise<{ content: string; isError: boolean }>
      checkinPlan: (planId: string, note: string, progress?: number) => Promise<ButlerWorkspaceData>
      addActivity: (text: string) => Promise<ButlerWorkspaceData>
      deleteActivity: (activityId: string) => Promise<ButlerWorkspaceData>
      notify: (title: string, body: string) => Promise<boolean>
      openFloatingReport: (reportId: string) => Promise<boolean>
      openFloatingPlan: (planId: string) => Promise<boolean>
      getExtensionsPath: () => Promise<string>
      openExtensionsFolder: () => Promise<string>
      invokeCustomTool: (toolId: string, input: string) => Promise<CustomToolResult>
      planTripWithAmap: (draft: { origin: string; destination: string; dateText: string }) => Promise<TripApiResult>
      exportTripCard: (card: { title: string; content: string }) => Promise<{ exported: boolean; path?: string }>
    }
  }
}
