import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getAppName: () => '桌面 AI 管家',
  getSystemInfo: () => ipcRenderer.invoke('system:get-info'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
})