export {}

type SystemInfo = {
  platform: string
  arch: string
  cpus: number
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

type CustomToolResult = {
  name: string
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

type AgentRunSnapshot = {
  id: string
  goal: string
  status: 'running' | 'completed' | 'blocked' | 'failed'
  turns: number
  startedAt: number
  finishedAt?: number
  observations: unknown[]
  final?: string
  error?: string
}

declare global {
  interface Window {
    electronAPI: {
      isElectron: boolean
      getAppName: () => string
      getAppVersion: () => Promise<string>
      getSystemInfo: () => Promise<SystemInfo>
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
      saveReport: (report: Omit<ButlerReport, 'id' | 'createdAt'>) => Promise<ButlerWorkspaceData>
      savePlan: (
        plan: Omit<ButlerPlan, 'id' | 'status' | 'checkins' | 'createdAt' | 'updatedAt'>,
      ) => Promise<ButlerWorkspaceData>
      updatePlan: (planId: string, patch: Partial<ButlerPlan>) => Promise<ButlerWorkspaceData>
      deletePlan: (planId: string) => Promise<ButlerWorkspaceData>
      checkinPlan: (planId: string, note: string) => Promise<ButlerWorkspaceData>
      addActivity: (text: string) => Promise<ButlerWorkspaceData>
      notify: (title: string, body: string) => Promise<boolean>
      openFloatingReport: (reportId: string) => Promise<boolean>
      getExtensionsPath: () => Promise<string>
      openExtensionsFolder: () => Promise<string>
      invokeCustomTool: (toolId: string, input: string) => Promise<CustomToolResult>
    }
  }
}
