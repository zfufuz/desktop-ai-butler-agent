// Agent 运行记录面板：展示任务状态、执行轮次、工具观察和失败原因。
import {
  AlertTriangle,
  CircleCheck,
  CircleX,
  Clock3,
  LoaderCircle,
  PauseCircle,
  Wrench,
} from 'lucide-react'

export type AgentRunSnapshot = {
  id: string
  goal: string
  status: 'queued' | 'running' | 'paused' | 'cancelled' | 'completed' | 'blocked' | 'failed'
  turns: number
  startedAt: number
  finishedAt?: number
  observations: unknown[]
  final?: string
  error?: string
}

type AgentRunsPanelProps = { runs: AgentRunSnapshot[] }

const statusLabels: Record<AgentRunSnapshot['status'], string> = {
  queued: '排队中',
  running: '运行中',
  paused: '已暂停',
  cancelled: '已取消',
  completed: '已完成',
  blocked: '受阻',
  failed: '失败',
}

function StatusIcon({ status }: { status: AgentRunSnapshot['status'] }) {
  if (status === 'completed') return <CircleCheck size={16} />
  if (status === 'failed' || status === 'cancelled') return <CircleX size={16} />
  if (status === 'blocked') return <AlertTriangle size={16} />
  if (status === 'paused') return <PauseCircle size={16} />
  return <LoaderCircle className={status === 'running' ? 'spin' : ''} size={16} />
}

function AgentRunsPanel({ runs }: AgentRunsPanelProps) {
  const orderedRuns = [...runs].sort((a, b) => b.startedAt - a.startedAt)

  return (
    <div className="insight-section agent-runs-panel">
      <div className="section-heading">
        <div>
          <h3>Agent 运行记录</h3>
          <p>展开一条任务即可查看耗时、工具调用和失败原因。</p>
        </div>
        <span className="section-count">{runs.length}</span>
      </div>

      <div className="agent-run-list">
        {orderedRuns.length === 0 ? (
          <p className="empty-state">还没有 Agent 运行记录。</p>
        ) : (
          orderedRuns.map((run) => {
            const duration = run.finishedAt
              ? `${((run.finishedAt - run.startedAt) / 1000).toFixed(1)} 秒`
              : '尚未结束'

            return (
              <details className={`agent-run-item ${run.status}`} key={run.id}>
                <summary>
                  <span className="run-summary">
                    <strong>{run.goal}</strong>
                    <small>{new Date(run.startedAt).toLocaleString('zh-CN')}</small>
                  </span>
                  <span className="run-status">
                    <StatusIcon status={run.status} />
                    {statusLabels[run.status]}
                  </span>
                </summary>

                <div className="run-facts">
                  <span><Clock3 size={14} />{duration}</span>
                  <span><LoaderCircle size={14} />{run.turns} 轮</span>
                  <span><Wrench size={14} />{run.observations.length} 次工具观察</span>
                </div>

                {run.error && <p className="run-error">{run.error}</p>}
                {run.final && <p className="run-final">{run.final}</p>}

                {run.observations.length > 0 && (
                  <div className="run-observation-list">
                    {run.observations.map((item, index) => {
                      const observation = item as {
                        toolName?: string
                        ok?: boolean
                        summary?: string
                        attempts?: number
                      }
                      return (
                        <div className={`run-observation ${observation.ok ? 'success' : 'failure'}`} key={index}>
                          <span className="observation-dot" aria-hidden="true" />
                          <div>
                            <strong>{observation.toolName ?? `观察 ${index + 1}`}</strong>
                            <small>
                              {observation.summary || (observation.ok ? '执行成功' : '执行失败')}
                              {observation.attempts && observation.attempts > 1
                                ? ` · 尝试 ${observation.attempts} 次`
                                : ''}
                            </small>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </details>
            )
          })
        )}
      </div>
    </div>
  )
}

export default AgentRunsPanel
