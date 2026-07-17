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
        <div className="avatar-face">AI</div>
        <div className="avatar-name">{appName}</div>
        <div className="avatar-system">{systemInfoText}</div>
        <div className="avatar-version">v{appVersion}</div>
        <div className="avatar-status">{statusText}</div>
      </div>
    </section>
  )
}

export default AvatarPanel
