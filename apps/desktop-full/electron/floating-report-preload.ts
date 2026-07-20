import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('floatingReport', {
  activity: () => ipcRenderer.send('floating-report:activity'),
  leave: () => ipcRenderer.send('floating-report:leave'),
  collapse: () => ipcRenderer.send('floating-report:collapse'),
  close: () => ipcRenderer.send('floating-report:close'),
})
