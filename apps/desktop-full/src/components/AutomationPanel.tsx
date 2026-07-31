import { Bot, CalendarClock, CheckCircle2, CircleOff, Play, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import type { ScheduledAgentJob, ScheduledAgentJobDraft } from '../automation/types'

type AutomationPanelProps = {
  jobs: ScheduledAgentJob[]
  onRefresh: () => Promise<void>
  onRunNow: (jobId: string) => Promise<void>
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function formatRunTime(timestamp?: number) {
  if (!timestamp) return '暂无安排'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(timestamp)
}

export function AutomationPanel({ jobs, onRefresh, onRunNow }: AutomationPanelProps) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [draft, setDraft] = useState<ScheduledAgentJobDraft>({
    title: '', prompt: '', schedule: 'daily', time: '09:00', weekday: 1, enabled: true,
  })

  function edit(job?: ScheduledAgentJob) {
    setDraft(job ? { ...job } : {
      title: '', prompt: '', schedule: 'daily', time: '09:00', weekday: 1, enabled: true,
    })
    setEditorOpen(true)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    await window.electronAPI.saveScheduledAgentJob(draft)
    setEditorOpen(false)
    setNotice('自动任务已保存')
    await onRefresh()
  }

  async function toggle(job: ScheduledAgentJob) {
    await window.electronAPI.saveScheduledAgentJob({ ...job, enabled: !job.enabled })
    await onRefresh()
  }

  async function remove(job: ScheduledAgentJob) {
    await window.electronAPI.deleteScheduledAgentJob(job.id)
    setNotice('自动任务已删除')
    await onRefresh()
  }

  return (
    <div className="automation-panel">
      <header className="automation-header">
        <div>
          <span className="eyebrow">Automations</span>
          <h3>自动任务</h3>
          <p>让 Agent 按时间执行整理、复盘或提醒，结果会进入运行记录。</p>
        </div>
        <button className="panel-action-button" onClick={() => edit()}><Plus size={16} />新建</button>
      </header>

      {notice && <div className="panel-notice">{notice}</div>}
      {jobs.length === 0 ? (
        <div className="automation-empty">
          <CalendarClock size={28} />
          <strong>还没有自动任务</strong>
          <span>例如：每天 18:00 汇总今日计划并给出明日建议。</span>
        </div>
      ) : (
        <div className="automation-list">
          {jobs.map((job) => (
            <article className={`automation-item ${job.enabled ? '' : 'disabled'}`} key={job.id}>
              <button className="automation-main" onClick={() => edit(job)}>
                <span className="automation-icon"><Bot size={18} /></span>
                <span>
                  <strong>{job.title}</strong>
                  <small>{job.prompt}</small>
                  <em>下次：{formatRunTime(job.nextRunAt)}</em>
                </span>
              </button>
              <div className="automation-actions">
                <button title="立即运行" onClick={() => onRunNow(job.id)} disabled={job.status === 'running'}><Play size={16} /></button>
                <button title={job.enabled ? '停用' : '启用'} onClick={() => toggle(job)}>
                  {job.enabled ? <CheckCircle2 size={16} /> : <CircleOff size={16} />}
                </button>
                <button title="删除" onClick={() => remove(job)}><Trash2 size={16} /></button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editorOpen && (
        <div className="automation-editor-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setEditorOpen(false)
        }}>
          <form className="automation-editor" onSubmit={save}>
            <header><div><span className="eyebrow">Agent Job</span><h3>{draft.id ? '编辑自动任务' : '新建自动任务'}</h3></div><button type="button" onClick={() => setEditorOpen(false)}>关闭</button></header>
            <label>任务名称<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="例如：每日计划复盘" required /></label>
            <label>交给 Agent 的要求<textarea value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} placeholder="汇总今天的计划和行动记录，找出停滞项并给出明日三项优先任务。" required /></label>
            <div className="automation-timing">
              <label>频率<select value={draft.schedule} onChange={(event) => setDraft({ ...draft, schedule: event.target.value as ScheduledAgentJob['schedule'] })}><option value="once">仅一次</option><option value="daily">每天</option><option value="weekly">每周</option></select></label>
              {draft.schedule === 'once' && <label>日期<input type="date" value={draft.runDate ?? ''} onChange={(event) => setDraft({ ...draft, runDate: event.target.value })} required /></label>}
              {draft.schedule === 'weekly' && <label>星期<select value={draft.weekday ?? 1} onChange={(event) => setDraft({ ...draft, weekday: Number(event.target.value) })}>{WEEKDAYS.map((day, index) => <option value={index} key={day}>{day}</option>)}</select></label>}
              <label>时间<input type="time" value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} required /></label>
            </div>
            <button className="panel-action-button automation-save" type="submit">保存自动任务</button>
          </form>
        </div>
      )}
    </div>
  )
}
