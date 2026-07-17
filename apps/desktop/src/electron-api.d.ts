export {}
type SystemInfo = {
  platform: string
  arch: string
  cpus: number
}
declare global {
  interface Window {
    electronAPI: {
  getAppName: () => string
  getAppVersion: () => Promise<string>
  getSystemInfo: () => Promise<SystemInfo>
    }
  }
}