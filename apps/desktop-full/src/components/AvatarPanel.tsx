import { Bot, HardDrive, ShieldCheck } from 'lucide-react'

type AvatarPanelProps = {
  appName: string
  appVersion: string
  systemInfoText: string
  statusText: string
}

function AvatarPanel({ appName, appVersion, systemInfoText, statusText }: AvatarPanelProps) {
  return (
    <section className="avatar-panel">
      <div className="avatar-placeholder">
        <div className="avatar-brand">
          <div className="avatar-face"><Bot aria-hidden="true" size={28} /></div>
          <div><div className="avatar-name">{appName}</div><div className="avatar-version">版本 {appVersion || '开发中'}</div></div>
        </div>
        <div className="avatar-status"><span className="status-dot" />{statusText}</div>
        <div className="avatar-meta">
          <span><HardDrive aria-hidden="true" size={15} />{systemInfoText || '正在读取系统信息'}</span>
          <span><ShieldCheck aria-hidden="true" size={15} />本地数据受保护</span>
        </div>
        <p className="avatar-note">文件、计划和运行记录默认保存在这台电脑上。</p>
      </div>
    </section>
  )
}

export default AvatarPanel
