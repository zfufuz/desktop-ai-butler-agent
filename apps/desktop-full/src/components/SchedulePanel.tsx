import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Focus,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  calculateScheduleBudget,
  findAvailableSlot,
  findScheduleConflicts,
  getEventDuration,
  minutesToTime,
  proposeSmartReplan,
  timeToMinutes,
  type ScheduleCategory,
  type ScheduleEvent,
  type ScheduleEventDraft,
} from '../schedule/scheduleEngine'

type SchedulePlan = {
  id: string
  title: string
  description: string
  status: 'active' | 'done'
  priority: 'low' | 'medium' | 'high'
  dueDate?: string
  recurrence: 'none' | 'daily' | 'weekly'
  progress: number
  nextAction?: string
}

type SchedulePanelProps = {
  plans: SchedulePlan[]
  onClose: () => void
  onWorkflowChange: () => Promise<void> | void
}

type ViewMode = 'day' | 'week'

const CATEGORY_META: Record<ScheduleCategory, { label: string; short: string }> = {
  focus: { label: '深度工作', short: '专注' },
  meeting: { label: '会议沟通', short: '会议' },
  life: { label: '生活休息', short: '生活' },
  deadline: { label: '关键截止', short: '截止' },
}

const HOURS = Array.from({ length: 13 }, (_, index) => index + 8)
const WORKDAY_MINUTES = 12 * 60

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function fromDateKey(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function addDays(key: string, days: number) {
  const date = fromDateKey(key)
  date.setDate(date.getDate() + days)
  return toDateKey(date)
}

function startOfWeek(key: string) {
  const date = fromDateKey(key)
  const offset = date.getDay() === 0 ? -6 : 1 - date.getDay()
  date.setDate(date.getDate() + offset)
  return toDateKey(date)
}

function formatDateTitle(key: string) {
  const date = fromDateKey(key)
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()]
  return `${date.getMonth() + 1}月${date.getDate()}日 · 周${weekday}`
}

function formatMinutes(value: number) {
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  if (!hours) return `${minutes} 分钟`
  return minutes ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`
}

function createDraft(date: string, start = '09:00'): ScheduleEventDraft {
  return {
    title: '',
    description: '',
    date,
    start,
    end: minutesToTime(timeToMinutes(start) + 60),
    category: 'focus',
    priority: 'medium',
    flexible: true,
    progress: 0,
    status: 'active',
    recurrence: 'none',
  }
}

export function SchedulePanel({ plans, onClose, onWorkflowChange }: SchedulePanelProps) {
  const today = useMemo(() => toDateKey(new Date()), [])
  const [events, setEvents] = useState<ScheduleEvent[]>([])
  const [selectedDate, setSelectedDate] = useState(today)
  const [viewMode, setViewMode] = useState<ViewMode>('day')
  const [loading, setLoading] = useState(true)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<ScheduleEvent | null>(null)
  const [draft, setDraft] = useState<ScheduleEventDraft>(() => createDraft(today))
  const [suggestion, setSuggestion] = useState<{ start: string; end: string } | null>(null)
  const [notice, setNotice] = useState('')
  const [focusEvent, setFocusEvent] = useState<ScheduleEvent | null>(null)
  const [focusSeconds, setFocusSeconds] = useState(25 * 60)
  const [focusRunning, setFocusRunning] = useState(false)

  useEffect(() => {
    let active = true
    window.electronAPI.getScheduleEvents().then((items) => {
      if (active) setEvents(items)
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!focusRunning || !focusEvent) return
    const timer = window.setInterval(() => {
      setFocusSeconds((current) => {
        if (current <= 1) {
          window.clearInterval(timer)
          setFocusRunning(false)
          void window.electronAPI.notify('专注结束', focusEvent.title)
          return 0
        }
        return current - 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [focusEvent, focusRunning])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2800)
    return () => window.clearTimeout(timer)
  }, [notice])

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(selectedDate), index)),
    [selectedDate],
  )
  const visibleDates = viewMode === 'day' ? [selectedDate] : weekDays
  const visibleEvents = events
    .filter((event) => visibleDates.includes(event.date))
    .sort((left, right) => left.date.localeCompare(right.date) || left.start.localeCompare(right.start))
  const dayEvents = visibleEvents.filter((event) => event.date === selectedDate)
  const budget = calculateScheduleBudget(events, selectedDate)
  const unscheduledPlans = plans.filter(
    (plan) => plan.status === 'active' && !events.some((event) => event.planId === plan.id && event.status === 'active'),
  )
  const nextEvent = dayEvents.find((event) => event.status === 'active')

  function openNew(date = selectedDate, start = '09:00', plan?: SchedulePlan) {
    setEditing(null)
    setDraft({
      ...createDraft(plan?.dueDate || date, start),
      planId: plan?.id,
      title: plan?.title ?? '',
      description: plan?.description ?? '',
      priority: plan?.priority ?? 'medium',
      progress: plan?.progress ?? 0,
      recurrence: plan?.recurrence ?? 'none',
      nextAction: plan?.nextAction,
      category: plan?.dueDate ? 'deadline' : 'focus',
    })
    setSuggestion(null)
    setEditorOpen(true)
  }

  function openEdit(event: ScheduleEvent) {
    setEditing(event)
    setDraft({ ...event })
    setSuggestion(null)
    setEditorOpen(true)
  }

  async function saveDraft(formEvent: FormEvent) {
    formEvent.preventDefault()
    const candidate: ScheduleEvent = {
      ...draft,
      id: editing?.id ?? '__candidate__',
      title: draft.title.trim(),
      description: draft.description.trim(),
      createdAt: editing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    }
    if (!candidate.title || getEventDuration(candidate) <= 0) {
      setNotice('请填写有效的标题和时间范围')
      return
    }
    const conflicts = findScheduleConflicts(events, candidate)
    if (conflicts.length > 0) {
      const availableSlot = suggestion ?? findAvailableSlot(events, candidate.date, getEventDuration(candidate), {
        ignoreId: editing?.id,
      })
      setSuggestion(availableSlot)
      setNotice(`与“${conflicts[0].title}”冲突`)
      return
    }
    const saved = await window.electronAPI.saveScheduleEvent({
      ...draft,
      id: editing?.id,
      title: candidate.title,
      description: candidate.description,
    })
    setEvents((current) => editing
      ? current.map((event) => event.id === editing.id ? saved : event)
      : [...current, saved])
    setEditorOpen(false)
    setNotice(editing ? '日程已更新' : '日程已创建')
  }

  function applySuggestion() {
    if (!suggestion) return
    setDraft((current) => ({ ...current, ...suggestion }))
    setSuggestion(null)
  }

  async function removeEvent(event: ScheduleEvent) {
    await window.electronAPI.deleteScheduleEvent(event.id)
    setEvents((current) => current.filter((item) => item.id !== event.id))
    setEditorOpen(false)
    setNotice('日程已删除')
  }

  async function toggleDone(event: ScheduleEvent) {
    const completed = event.status !== 'done'
    const saved = await window.electronAPI.saveScheduleEvent({
      ...event,
      status: completed ? 'done' : 'active',
      progress: completed ? 100 : event.progress,
    })
    setEvents((current) => current.map((item) => item.id === saved.id ? saved : item))
    if (event.planId) {
      await window.electronAPI.updatePlan(event.planId, {
        status: completed ? 'done' : 'active',
        progress: completed ? 100 : event.progress,
      })
    }
    if (!event.planId) {
      await window.electronAPI.addActivity(`${completed ? '完成' : '重新开始'}日程：${event.title}`)
    }
    await onWorkflowChange()
    setNotice(completed ? '日程和关联计划已完成' : '日程已重新开始')
  }

  async function smartReplan() {
    const proposal = proposeSmartReplan(events, selectedDate)
    if (!proposal) {
      setNotice('当前没有需要调整的灵活日程')
      return
    }
    const target = events.find((event) => event.id === proposal.eventId)
    if (!target) return
    const saved = await window.electronAPI.saveScheduleEvent({ ...target, ...proposal.to })
    setEvents((current) => current.map((event) => event.id === saved.id ? saved : event))
    setNotice(`“${saved.title}”已调整到 ${saved.start}`)
  }

  function moveDate(direction: number) {
    setSelectedDate((current) => addDays(current, direction * (viewMode === 'week' ? 7 : 1)))
  }

  function openAtTimelinePosition(clientY: number, element: HTMLElement) {
    const rect = element.getBoundingClientRect()
    const rawMinutes = 8 * 60 + Math.round((((clientY - rect.top) / rect.height) * WORKDAY_MINUTES) / 15) * 15
    openNew(selectedDate, minutesToTime(rawMinutes))
  }

  function startFocus(event: ScheduleEvent) {
    setFocusEvent(event)
    setFocusSeconds(25 * 60)
    setFocusRunning(false)
  }

  return (
    <div className="schedule-center" role="dialog" aria-label="时间规划中心">
      <header className="schedule-header">
        <div>
          <span>CHRONODECK · DESKTOP AGENT</span>
          <h2>时间规划中心</h2>
        </div>
        <div className="schedule-header-controls">
          <div className="schedule-segmented" aria-label="日历视图">
            <button className={viewMode === 'day' ? 'active' : ''} onClick={() => setViewMode('day')}>日</button>
            <button className={viewMode === 'week' ? 'active' : ''} onClick={() => setViewMode('week')}>周</button>
          </div>
          <button className="schedule-icon-button" title="关闭时间规划中心" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="schedule-toolbar">
        <div className="schedule-date-nav">
          <button className="schedule-icon-button" title="上一段时间" onClick={() => moveDate(-1)}><ChevronLeft size={17} /></button>
          <button onClick={() => setSelectedDate(today)}>今天</button>
          <button className="schedule-icon-button" title="下一段时间" onClick={() => moveDate(1)}><ChevronRight size={17} /></button>
          <strong>{formatDateTitle(selectedDate)}</strong>
        </div>
        <div>
          <button onClick={smartReplan}><RefreshCw size={15} />智能重排</button>
          <button className="schedule-primary" onClick={() => openNew()}><Plus size={16} />新建日程</button>
        </div>
      </div>

      <div className="schedule-layout">
        <aside className="schedule-sidebar">
          <section>
            <div className="schedule-section-heading">
              <span>时间预算</span>
              <strong className={budget.loadPercent > 100 ? 'over' : ''}>{budget.loadPercent}%</strong>
            </div>
            <div className="schedule-load-track"><i style={{ width: `${Math.min(100, budget.loadPercent)}%` }} /></div>
            <dl className="schedule-stats">
              <div><dt>已安排</dt><dd>{formatMinutes(budget.scheduledMinutes)}</dd></div>
              <div><dt>剩余</dt><dd>{formatMinutes(budget.remainingMinutes)}</dd></div>
              <div><dt>日程</dt><dd>{dayEvents.length} 项</dd></div>
            </dl>
          </section>

          <section>
            <div className="schedule-section-heading"><span>待安排计划</span><strong>{unscheduledPlans.length}</strong></div>
            <div className="schedule-plan-list">
              {unscheduledPlans.slice(0, 6).map((plan) => (
                <button key={plan.id} onClick={() => openNew(selectedDate, '09:00', plan)}>
                  <span>{plan.title}</span>
                  <small>{plan.dueDate ? `截止 ${plan.dueDate}` : '未设置日期'}</small>
                  <Plus size={14} />
                </button>
              ))}
              {unscheduledPlans.length === 0 && <p>所有进行中计划都已安排。</p>}
            </div>
          </section>

          <section>
            <div className="schedule-section-heading"><span>下一项</span><Clock3 size={15} /></div>
            {nextEvent ? (
              <div className="schedule-next">
                <small>{nextEvent.start}–{nextEvent.end}</small>
                <strong>{nextEvent.title}</strong>
                <p>{nextEvent.nextAction || nextEvent.description || '准备进入下一段时间。'}</p>
                <div>
                  <button title="进入专注" onClick={() => startFocus(nextEvent)}><Focus size={15} />专注</button>
                  <button title="完成日程" onClick={() => toggleDone(nextEvent)}><Check size={15} />完成</button>
                </div>
              </div>
            ) : <p>这一天没有待执行日程。</p>}
          </section>
        </aside>

        <section className="schedule-board">
          {loading ? (
            <div className="schedule-empty">正在读取本地日程...</div>
          ) : viewMode === 'day' ? (
            <div className="schedule-day-view">
              <div className="schedule-time-axis">
                {HOURS.map((hour) => <span key={hour} style={{ top: `${((hour - 8) / 12) * 100}%` }}>{pad(hour)}:00</span>)}
              </div>
              <div
                className="schedule-timeline"
                onDoubleClick={(event) => openAtTimelinePosition(event.clientY, event.currentTarget)}
              >
                {HOURS.map((hour) => <i className="schedule-hour-line" key={hour} style={{ top: `${((hour - 8) / 12) * 100}%` }} />)}
                {dayEvents.map((event) => (
                  <button
                    key={event.id}
                    className={`schedule-event ${event.category} ${event.status}`}
                    style={{
                      top: `${((timeToMinutes(event.start) - 8 * 60) / WORKDAY_MINUTES) * 100}%`,
                      height: `${Math.max(5, (getEventDuration(event) / WORKDAY_MINUTES) * 100)}%`,
                    }}
                    onClick={() => openEdit(event)}
                  >
                    <small>{event.start}–{event.end}</small>
                    <strong>{event.title}</strong>
                    <span>{CATEGORY_META[event.category].label} · {event.progress}%</span>
                  </button>
                ))}
                {dayEvents.length === 0 && (
                  <button className="schedule-empty" onClick={() => openNew()}>
                    <CalendarDays size={24} />
                    <strong>今天还没有安排</strong>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="schedule-week-view">
              {weekDays.map((date) => {
                const items = visibleEvents.filter((event) => event.date === date)
                return (
                  <div className={date === today ? 'today' : ''} key={date}>
                    <button className="schedule-week-heading" onClick={() => {
                      setSelectedDate(date)
                      setViewMode('day')
                    }}>
                      <span>周{['日', '一', '二', '三', '四', '五', '六'][fromDateKey(date).getDay()]}</span>
                      <strong>{fromDateKey(date).getDate()}</strong>
                    </button>
                    {items.map((event) => (
                      <button className={`schedule-week-event ${event.category} ${event.status}`} key={event.id} onClick={() => openEdit(event)}>
                        <small>{event.start}</small>
                        <strong>{event.title}</strong>
                      </button>
                    ))}
                    <button className="schedule-week-add" title="在这一天新增日程" onClick={() => openNew(date)}><Plus size={14} /></button>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {editorOpen && (
        <div className="schedule-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setEditorOpen(false)
        }}>
          <form className="schedule-editor" onSubmit={saveDraft}>
            <header>
              <div><span>{editing ? '编辑日程' : draft.planId ? '安排计划' : '新建日程'}</span><h3>{editing?.title || draft.title || '未命名日程'}</h3></div>
              <button type="button" className="schedule-icon-button" title="关闭" onClick={() => setEditorOpen(false)}><X size={17} /></button>
            </header>
            <label className="wide"><span>标题</span><input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
            <div className="schedule-editor-grid">
              <label><span>日期</span><input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
              <label><span>开始</span><input type="time" value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} /></label>
              <label><span>结束</span><input type="time" value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} /></label>
            </div>
            <label className="wide"><span>说明</span><textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
            <div className="schedule-category-picker">
              {(Object.keys(CATEGORY_META) as ScheduleCategory[]).map((category) => (
                <button
                  type="button"
                  className={`${category} ${draft.category === category ? 'active' : ''}`}
                  key={category}
                  onClick={() => setDraft({ ...draft, category })}
                >
                  <i />{CATEGORY_META[category].label}
                </button>
              ))}
            </div>
            <div className="schedule-editor-grid">
              <label><span>优先级</span><select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as ScheduleEventDraft['priority'] })}><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label>
              <label><span>重复</span><select value={draft.recurrence} onChange={(event) => setDraft({ ...draft, recurrence: event.target.value as ScheduleEventDraft['recurrence'] })}><option value="none">不重复</option><option value="daily">每天</option><option value="weekly">每周</option></select></label>
              <label className="schedule-flexible"><input type="checkbox" checked={draft.flexible} onChange={(event) => setDraft({ ...draft, flexible: event.target.checked })} /><span>允许重排</span></label>
            </div>
            <label className="wide"><span>下一步</span><input value={draft.nextAction ?? ''} onChange={(event) => setDraft({ ...draft, nextAction: event.target.value })} /></label>
            {suggestion && (
              <div className="schedule-conflict">
                <span>检测到时间冲突</span>
                <button type="button" onClick={applySuggestion}>调整到 {suggestion.start}–{suggestion.end}</button>
              </div>
            )}
            <footer>
              {editing && <button type="button" className="danger" title="删除日程" onClick={() => removeEvent(editing)}><Trash2 size={15} />删除</button>}
              <span />
              <button type="button" onClick={() => setEditorOpen(false)}>取消</button>
              <button className="schedule-primary" type="submit">{editing ? '保存' : '加入日程'}</button>
            </footer>
          </form>
        </div>
      )}

      {focusEvent && (
        <div className="schedule-focus">
          <button className="schedule-icon-button" title="退出专注" onClick={() => {
            setFocusEvent(null)
            setFocusRunning(false)
          }}><X size={18} /></button>
          <span>FOCUS SESSION</span>
          <h3>{focusEvent.title}</h3>
          <strong>{pad(Math.floor(focusSeconds / 60))}:{pad(focusSeconds % 60)}</strong>
          <p>{focusEvent.nextAction || '只处理当前这一件事。'}</p>
          <div>
            <button className="schedule-primary" onClick={() => setFocusRunning((current) => !current)}>{focusRunning ? '暂停' : focusSeconds === 0 ? '重新开始' : '开始专注'}</button>
            <button onClick={() => {
              void toggleDone(focusEvent)
              setFocusEvent(null)
              setFocusRunning(false)
            }}>完成</button>
          </div>
        </div>
      )}

      {notice && <div className="schedule-notice" role="status">{notice}</div>}
    </div>
  )
}
