import { Download, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'

export type AuditLogLevel = 'info' | 'warn' | 'error'
export type AuditLogStatus = 'success' | 'failure' | 'pending'
export type AuditLogCategory = 'system' | 'agent' | 'tool' | 'file' | 'knowledge' | 'workflow' | 'security'

export type AuditLogFilters = {
  level?: AuditLogLevel | 'all'
  category?: AuditLogCategory | 'all'
  status?: AuditLogStatus | 'all'
  query?: string
  limit?: number
}

export type AuditLogEntry = {
  id: string
  createdAt: number
  level: AuditLogLevel
  category: AuditLogCategory
  action: string
  summary: string
  detail?: string
  status: AuditLogStatus
  runId?: string
  durationMs?: number
  metadata: Record<string, unknown>
}

type AuditLogPanelProps = {
  logs: AuditLogEntry[]
  loading: boolean
  onLoad: (filters: AuditLogFilters) => Promise<void>
  onExport: (filters: AuditLogFilters) => Promise<void>
  onClear: () => Promise<void>
}

const categoryLabels: Record<AuditLogCategory, string> = {
  system: '系统',
  agent: 'Agent',
  tool: '工具',
  file: '文件',
  knowledge: '知识库',
  workflow: '工作流',
  security: '安全',
}

const statusLabels: Record<AuditLogStatus, string> = {
  success: '成功',
  failure: '失败',
  pending: '进行中',
}

function AuditLogPanel({ logs, loading, onLoad, onExport, onClear }: AuditLogPanelProps) {
  const [filters, setFilters] = useState<AuditLogFilters>({ level: 'all', category: 'all', status: 'all', query: '', limit: 300 })

  return (
    <div className="insight-section audit-log-panel">
      <div className="audit-log-heading">
        <div>
          <h3>审计日志</h3>
          <p>记录 Agent、工具、文件、知识库、计划、配置和系统异常。敏感字段会自动脱敏。</p>
        </div>
        <div className="audit-log-actions">
          <button title="刷新日志" aria-label="刷新日志" onClick={() => onLoad(filters)} disabled={loading}>
            <RefreshCw size={16} />
          </button>
          <button title="导出日志" aria-label="导出日志" onClick={() => onExport(filters)} disabled={loading || logs.length === 0}>
            <Download size={16} />
          </button>
          <button className="danger" title="清理日志" aria-label="清理日志" onClick={onClear} disabled={loading || logs.length === 0}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="audit-log-filters">
        <input
          value={filters.query ?? ''}
          placeholder="搜索摘要、动作或错误"
          onChange={(event) => setFilters({ ...filters, query: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void onLoad(filters)
          }}
        />
        <select value={filters.level} onChange={(event) => setFilters({ ...filters, level: event.target.value as AuditLogFilters['level'] })}>
          <option value="all">全部级别</option>
          <option value="info">信息</option>
          <option value="warn">警告</option>
          <option value="error">错误</option>
        </select>
        <select value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value as AuditLogFilters['category'] })}>
          <option value="all">全部类别</option>
          {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value as AuditLogFilters['status'] })}>
          <option value="all">全部状态</option>
          <option value="success">成功</option>
          <option value="failure">失败</option>
          <option value="pending">进行中</option>
        </select>
        <button onClick={() => onLoad(filters)} disabled={loading}>{loading ? '加载中' : '筛选'}</button>
      </div>

      <div className="audit-log-summary">
        <span>当前 {logs.length} 条</span>
        <span>{logs.filter((log) => log.status === 'failure').length} 条失败</span>
        <span>{logs.filter((log) => log.level === 'warn').length} 条警告</span>
      </div>

      <div className="audit-log-list">
        {logs.length === 0 ? <p>暂无符合条件的日志。</p> : logs.map((log) => (
          <details className={`audit-log-item ${log.level} ${log.status}`} key={log.id}>
            <summary>
              <span className="audit-log-dot" aria-hidden="true" />
              <span className="audit-log-copy">
                <strong>{log.summary}</strong>
                <small>{new Date(log.createdAt).toLocaleString('zh-CN')} · {categoryLabels[log.category]} · {statusLabels[log.status]}{typeof log.durationMs === 'number' ? ` · ${log.durationMs} ms` : ''}</small>
              </span>
            </summary>
            <div className="audit-log-detail">
              <code>{log.action}</code>
              {log.detail && <pre>{log.detail}</pre>}
              {Object.keys(log.metadata ?? {}).length > 0 && <pre>{JSON.stringify(log.metadata, null, 2)}</pre>}
              {log.runId && <small>Run ID: {log.runId}</small>}
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}

export default AuditLogPanel
