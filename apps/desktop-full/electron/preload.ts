// Electron 安全桥：仅向 React 渲染层暴露经过白名单约束的 IPC 能力。
import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getAppName: () => '桌面 AI 管家',
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  getSystemInfo: () => ipcRenderer.invoke('system:get-info'),
  getBackendStatus: () => ipcRenderer.invoke('backend:get-status'),
  restartBackend: () => ipcRenderer.invoke('backend:restart'),
  diagnoseBackend: (message: string) => ipcRenderer.invoke('backend:diagnose', message),
  sendChatMessage: (message: string) => ipcRenderer.invoke('ai:chat', message),
  streamChatMessage: (message: string, onDelta: (delta: string) => void) => {
    const requestId = crypto.randomUUID()
    const listener = (_event: Electron.IpcRendererEvent, incomingId: string, delta: string) => {
      if (incomingId === requestId) onDelta(delta)
    }
    ipcRenderer.on('ai:chat-stream-delta', listener)
    return ipcRenderer
      .invoke('ai:chat-stream', requestId, message)
      .finally(() => ipcRenderer.removeListener('ai:chat-stream-delta', listener))
  },
  pickTextFile: () => ipcRenderer.invoke('file:pick-text'),
  pickTextFiles: () => ipcRenderer.invoke('file:pick-text-many'),
  pickTextDirectory: () => ipcRenderer.invoke('file:pick-directory-text'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  readDroppedFile: (filePath: string) => ipcRenderer.invoke('file:read-dropped', filePath),
  readNamedTextFile: (query: string) => ipcRenderer.invoke('file:read-named-text', query),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggle-always-on-top'),
  getPlatformConfig: () => ipcRenderer.invoke('platform:get-config'),
  savePlatformConfig: (config: unknown) => ipcRenderer.invoke('platform:save-config', config),
  getWorkflowData: () => ipcRenderer.invoke('workflow:get-data'),
  getAgentRuns: () => ipcRenderer.invoke('agent-runs:list'),
  saveAgentRun: (run: unknown) => ipcRenderer.invoke('agent-runs:save', run),
  getAuditLogs: (filters: unknown) => ipcRenderer.invoke('audit:list', filters),
  exportAuditLogs: (filters: unknown) => ipcRenderer.invoke('audit:export', filters),
  clearAuditLogs: () => ipcRenderer.invoke('audit:clear'),
  exportUserData: () => ipcRenderer.invoke('data:export'),
  clearUserData: () => ipcRenderer.invoke('data:clear'),
  openDataFolder: () => ipcRenderer.invoke('data:open-folder'),
  syncKnowledgeDocuments: (documents: unknown) => ipcRenderer.invoke('knowledge:sync', documents),
  getKnowledgeDocuments: () => ipcRenderer.invoke('knowledge:list'),
  upsertKnowledgeDocument: (document: unknown) => ipcRenderer.invoke('knowledge:upsert', document),
  searchKnowledge: (query: string, limit = 6) => ipcRenderer.invoke('knowledge:search', query, limit),
  rebuildKnowledgeEmbeddings: () => ipcRenderer.invoke('knowledge:rebuild-embeddings'),
  deleteKnowledgeDocument: (documentId: string) => ipcRenderer.invoke('knowledge:delete', documentId),
  getMemoryNotes: () => ipcRenderer.invoke('memory:list'),
  syncMemoryNotes: (notes: unknown) => ipcRenderer.invoke('memory:sync', notes),
  addMemoryNote: (text: string, category?: string, expiresAt?: number) => ipcRenderer.invoke('memory:add', text, category, expiresAt),
  updateMemoryNote: (noteId: string, patch: unknown) => ipcRenderer.invoke('memory:update', noteId, patch),
  deleteMemoryNote: (noteId: string) => ipcRenderer.invoke('memory:delete', noteId),
  saveReport: (report: unknown) => ipcRenderer.invoke('workflow:save-report', report),
  deleteReport: (reportId: string) => ipcRenderer.invoke('workflow:delete-report', reportId),
  savePlan: (plan: unknown) => ipcRenderer.invoke('workflow:save-plan', plan),
  updatePlan: (planId: string, patch: unknown) => ipcRenderer.invoke('workflow:update-plan', planId, patch),
  deletePlan: (planId: string) => ipcRenderer.invoke('workflow:delete-plan', planId),
  getScheduleEvents: (startDate?: string, endDate?: string) => ipcRenderer.invoke('schedule:list', startDate, endDate),
  saveScheduleEvent: (scheduleEvent: unknown) => ipcRenderer.invoke('schedule:save', scheduleEvent),
  deleteScheduleEvent: (eventId: string) => ipcRenderer.invoke('schedule:delete', eventId),
  checkinPlan: (planId: string, note: string, progress?: number) => ipcRenderer.invoke('workflow:checkin-plan', planId, note, progress),
  addActivity: (text: string) => ipcRenderer.invoke('workflow:add-activity', text),
  deleteActivity: (activityId: string) => ipcRenderer.invoke('workflow:delete-activity', activityId),
  notify: (title: string, body: string) => ipcRenderer.invoke('workflow:notify', title, body),
  openFloatingReport: (reportId: string) => ipcRenderer.invoke('workflow:open-floating-report', reportId),
  openFloatingPlan: (planId: string) => ipcRenderer.invoke('workflow:open-floating-plan', planId),
  getExtensionsPath: () => ipcRenderer.invoke('platform:get-extensions-path'),
  openExtensionsFolder: () => ipcRenderer.invoke('platform:open-extensions-folder'),
  invokeCustomTool: (toolId: string, input: string) =>
    ipcRenderer.invoke('tool:invoke-custom', toolId, input),
  planTripWithAmap: (draft: unknown) => ipcRenderer.invoke('trip:plan-amap', draft),
  exportTripCard: (card: unknown) => ipcRenderer.invoke('trip:export-card', card),
})
