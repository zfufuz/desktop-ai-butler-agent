import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getAppName: () => '桌面 AI 管家',
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  getSystemInfo: () => ipcRenderer.invoke('system:get-info'),
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
  syncKnowledgeDocuments: (documents: unknown) => ipcRenderer.invoke('knowledge:sync', documents),
  getKnowledgeDocuments: () => ipcRenderer.invoke('knowledge:list'),
  upsertKnowledgeDocument: (document: unknown) => ipcRenderer.invoke('knowledge:upsert', document),
  searchKnowledge: (query: string, limit = 6) => ipcRenderer.invoke('knowledge:search', query, limit),
  deleteKnowledgeDocument: (documentId: string) => ipcRenderer.invoke('knowledge:delete', documentId),
  getMemoryNotes: () => ipcRenderer.invoke('memory:list'),
  syncMemoryNotes: (notes: unknown) => ipcRenderer.invoke('memory:sync', notes),
  addMemoryNote: (text: string) => ipcRenderer.invoke('memory:add', text),
  deleteMemoryNote: (noteId: string) => ipcRenderer.invoke('memory:delete', noteId),
  saveReport: (report: unknown) => ipcRenderer.invoke('workflow:save-report', report),
  deleteReport: (reportId: string) => ipcRenderer.invoke('workflow:delete-report', reportId),
  savePlan: (plan: unknown) => ipcRenderer.invoke('workflow:save-plan', plan),
  updatePlan: (planId: string, patch: unknown) => ipcRenderer.invoke('workflow:update-plan', planId, patch),
  deletePlan: (planId: string) => ipcRenderer.invoke('workflow:delete-plan', planId),
  checkinPlan: (planId: string, note: string) => ipcRenderer.invoke('workflow:checkin-plan', planId, note),
  addActivity: (text: string) => ipcRenderer.invoke('workflow:add-activity', text),
  deleteActivity: (activityId: string) => ipcRenderer.invoke('workflow:delete-activity', activityId),
  notify: (title: string, body: string) => ipcRenderer.invoke('workflow:notify', title, body),
  openFloatingReport: (reportId: string) => ipcRenderer.invoke('workflow:open-floating-report', reportId),
  getExtensionsPath: () => ipcRenderer.invoke('platform:get-extensions-path'),
  openExtensionsFolder: () => ipcRenderer.invoke('platform:open-extensions-folder'),
  invokeCustomTool: (toolId: string, input: string) =>
    ipcRenderer.invoke('tool:invoke-custom', toolId, input),
})
