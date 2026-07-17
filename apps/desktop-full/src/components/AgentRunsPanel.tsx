export type AgentRunSnapshot = {
  id: string
  goal: string
  status: 'running' | 'completed' | 'blocked' | 'failed'
  turns: number
  startedAt: number
  finishedAt?: number
  observations: unknown[]
  final?: string
  error?: string
}

type AgentRunsPanelProps = {
  runs: AgentRunSnapshot[]
}

function getStatusLabel(status: AgentRunSnapshot['status']) {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'blocked') return '受阻'
  return '运行中'
}

function AgentRunsPanel({ runs }: AgentRunsPanelProps) {
  return (
    <div className="insight-section">
      <h3>Agent 运行记录</h3>
      <p>每次自主执行都会记录目标、轮次、工具结果和耗时，方便定位“为什么这样回答”。</p>
      <div className="agent-run-list">
        {runs.length === 0 ? <p>还没有 Agent 运行记录。</p> : runs.map((run) => (
          <details className={`agent-run-item ${run.status}`} key={run.id}>
            <summary>
              <span><strong>{run.goal}</strong><small>{new Date(run.startedAt).toLocaleString('zh-CN')}</small></span>
              <b>{getStatusLabel(run.status)}</b>
            </summary>
            <p>{run.turns} 轮 · {run.observations.length} 次工具观察 · {run.finishedAt ? `${((run.finishedAt - run.startedAt) / 1000).toFixed(1)} 秒` : '尚未结束'}</p>
            {run.error && <p className="run-error">{run.error}</p>}
            {run.observations.map((item, index) => {
              const observation = item as { toolName?: string; ok?: boolean; summary?: string }
              return <div className="run-observation" key={index}><strong>{observation.toolName ?? `观察 ${index + 1}`}</strong><small>{observation.ok ? '成功' : '失败'} · {observation.summary}</small></div>
            })}
          </details>
        ))}
      </div>
    </div>
  )
}

export default AgentRunsPanel
