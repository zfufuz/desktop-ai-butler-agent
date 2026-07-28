// 桌面行动卡安全桥：转发拖动、收起和关闭等最小窗口控制事件。
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('floatingReport', {
  activity: () => ipcRenderer.send('floating-report:activity'),
  leave: () => ipcRenderer.send('floating-report:leave'),
  collapse: () => ipcRenderer.send('floating-report:collapse'),
  close: () => ipcRenderer.send('floating-report:close'),
})
