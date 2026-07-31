import { Cable, CircleOff, PlugZap, RefreshCw, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import type { McpServerConfig, McpServerDraft } from '../mcp/types'

type Props = {
  servers: McpServerConfig[]
  onRefresh: () => Promise<void>
}

export function McpSettingsPanel({ servers, onRefresh }: Props) {
  const [draft, setDraft] = useState<McpServerDraft>({ name: '', command: '', args: [], enabled: true })
  const [argsText, setArgsText] = useState('')
  const [busyId, setBusyId] = useState('')
  const [notice, setNotice] = useState('')

  async function save(event: FormEvent) {
    event.preventDefault()
    await window.electronAPI.saveMcpServer({
      ...draft,
      args: argsText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    })
    setDraft({ name: '', command: '', args: [], enabled: true })
    setArgsText('')
    setNotice('MCP Server 已保存，请连接测试并发现工具。')
    await onRefresh()
  }

  async function discover(server: McpServerConfig) {
    if (!window.confirm(`将启动本地命令“${server.command} ${server.args.join(' ')}”并连接 MCP Server，是否继续？`)) return
    setBusyId(server.id)
    try {
      const updated = await window.electronAPI.discoverMcpServer(server.id)
      setNotice(`连接成功，发现 ${updated.tools.length} 个工具。`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'MCP Server 连接失败')
    } finally {
      setBusyId('')
      await onRefresh()
    }
  }

  async function toggle(server: McpServerConfig) {
    await window.electronAPI.saveMcpServer({ ...server, enabled: !server.enabled })
    await onRefresh()
  }

  async function remove(server: McpServerConfig) {
    await window.electronAPI.deleteMcpServer(server.id)
    await onRefresh()
  }

  return (
    <div className="settings-block mcp-settings">
      <h3>MCP Server</h3>
      <p className="settings-help">连接本地 stdio MCP Server，发现的工具会加入 Agent Tool Registry，并在调用前请求权限。</p>
      {notice && <div className="panel-notice">{notice}</div>}
      <form className="mcp-form" onSubmit={save}>
        <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Server 名称，例如 Filesystem" required />
        <input value={draft.command} onChange={(event) => setDraft({ ...draft, command: event.target.value })} placeholder="启动命令，例如 npx 或 node" required />
        <textarea value={argsText} onChange={(event) => setArgsText(event.target.value)} placeholder={'启动参数，每行一个\n例如：-y\n@modelcontextprotocol/server-filesystem\nC:\\资料库'} />
        <input value={draft.cwd ?? ''} onChange={(event) => setDraft({ ...draft, cwd: event.target.value })} placeholder="工作目录（可选）" />
        <button className="panel-action-button" type="submit"><Cable size={16} />保存 Server</button>
      </form>
      <div className="mcp-server-list">
        {servers.length === 0 && <p>还没有配置 MCP Server。</p>}
        {servers.map((server) => (
          <article className="mcp-server-item" key={server.id}>
            <div>
              <strong>{server.name}</strong>
              <code>{server.command} {server.args.join(' ')}</code>
              <small>{server.status === 'connected' ? `已发现 ${server.tools.length} 个工具` : server.lastError || '尚未连接测试'}</small>
            </div>
            <div>
              <button title="连接测试并刷新工具" onClick={() => discover(server)} disabled={busyId === server.id}><RefreshCw size={16} /></button>
              <button title={server.enabled ? '停用' : '启用'} onClick={() => toggle(server)}>{server.enabled ? <PlugZap size={16} /> : <CircleOff size={16} />}</button>
              <button title="删除" onClick={() => remove(server)}><Trash2 size={16} /></button>
            </div>
            {server.tools.length > 0 && <ul>{server.tools.map((tool) => <li key={tool.name}><b>{tool.name}</b><span>{tool.description}</span></li>)}</ul>}
          </article>
        ))}
      </div>
    </div>
  )
}
