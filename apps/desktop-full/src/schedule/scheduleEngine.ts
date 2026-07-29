export type ScheduleCategory = 'focus' | 'meeting' | 'life' | 'deadline'
export type ScheduleStatus = 'active' | 'done'

export type ScheduleEvent = {
  id: string
  planId?: string
  title: string
  description: string
  date: string
  start: string
  end: string
  category: ScheduleCategory
  priority: 'low' | 'medium' | 'high'
  flexible: boolean
  progress: number
  status: ScheduleStatus
  recurrence: 'none' | 'daily' | 'weekly'
  nextAction?: string
  createdAt: number
  updatedAt: number
}

export type ScheduleEventDraft = Omit<ScheduleEvent, 'id' | 'createdAt' | 'updatedAt'>

export type ScheduleConflict = {
  eventId: string
  title: string
  start: string
  end: string
}

export type ScheduleBudget = {
  scheduledMinutes: number
  availableMinutes: number
  remainingMinutes: number
  loadPercent: number
}

export function timeToMinutes(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  if (!match) return Number.NaN
  return Number(match[1]) * 60 + Number(match[2])
}

export function minutesToTime(value: number) {
  const safeValue = Math.max(0, Math.min(23 * 60 + 59, Math.round(value)))
  return `${String(Math.floor(safeValue / 60)).padStart(2, '0')}:${String(safeValue % 60).padStart(2, '0')}`
}

export function getEventDuration(event: Pick<ScheduleEvent, 'start' | 'end'>) {
  const start = timeToMinutes(event.start)
  const end = timeToMinutes(event.end)
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0
}

export function isValidScheduleRange(start: string, end: string) {
  const startMinutes = timeToMinutes(start)
  const endMinutes = timeToMinutes(end)
  return Number.isFinite(startMinutes) && Number.isFinite(endMinutes) && endMinutes > startMinutes
}

export function eventsOverlap(
  left: Pick<ScheduleEvent, 'id' | 'date' | 'start' | 'end'>,
  right: Pick<ScheduleEvent, 'id' | 'date' | 'start' | 'end'>,
) {
  if (left.id === right.id || left.date !== right.date) return false
  return timeToMinutes(left.start) < timeToMinutes(right.end)
    && timeToMinutes(right.start) < timeToMinutes(left.end)
}

export function findScheduleConflicts(events: ScheduleEvent[], candidate: ScheduleEvent) {
  return events
    .filter((event) => event.status === 'active' && eventsOverlap(event, candidate))
    .map<ScheduleConflict>((event) => ({
      eventId: event.id,
      title: event.title,
      start: event.start,
      end: event.end,
    }))
}

export function findAvailableSlot(
  events: ScheduleEvent[],
  date: string,
  durationMinutes: number,
  options: { workdayStart?: string; workdayEnd?: string; ignoreId?: string; stepMinutes?: number } = {},
) {
  const start = timeToMinutes(options.workdayStart ?? '08:00')
  const end = timeToMinutes(options.workdayEnd ?? '20:00')
  const step = Math.max(5, options.stepMinutes ?? 15)
  if (!Number.isFinite(start) || !Number.isFinite(end) || durationMinutes <= 0) return null

  for (let cursor = start; cursor + durationMinutes <= end; cursor += step) {
    const candidate: ScheduleEvent = {
      id: options.ignoreId ?? '__candidate__',
      title: '',
      description: '',
      date,
      start: minutesToTime(cursor),
      end: minutesToTime(cursor + durationMinutes),
      category: 'focus',
      priority: 'medium',
      flexible: true,
      progress: 0,
      status: 'active',
      recurrence: 'none',
      createdAt: 0,
      updatedAt: 0,
    }
    if (findScheduleConflicts(events, candidate).length === 0) {
      return { start: candidate.start, end: candidate.end }
    }
  }
  return null
}

export function calculateScheduleBudget(
  events: ScheduleEvent[],
  date: string,
  workdayStart = '08:00',
  workdayEnd = '20:00',
): ScheduleBudget {
  const availableMinutes = Math.max(0, timeToMinutes(workdayEnd) - timeToMinutes(workdayStart))
  const scheduledMinutes = events
    .filter((event) => event.date === date && event.status === 'active')
    .reduce((total, event) => total + getEventDuration(event), 0)
  return {
    scheduledMinutes,
    availableMinutes,
    remainingMinutes: Math.max(0, availableMinutes - scheduledMinutes),
    loadPercent: availableMinutes > 0 ? Math.round((scheduledMinutes / availableMinutes) * 100) : 0,
  }
}

export function proposeSmartReplan(events: ScheduleEvent[], date: string) {
  const dayEvents = events
    .filter((event) => event.date === date && event.status === 'active')
    .sort((left, right) => left.start.localeCompare(right.start))
  const candidate = dayEvents
    .filter((event) => event.flexible)
    .sort((left, right) => {
      const priorityOrder = { low: 0, medium: 1, high: 2 }
      return priorityOrder[left.priority] - priorityOrder[right.priority]
        || getEventDuration(right) - getEventDuration(left)
    })[0]
  if (!candidate) return null

  const slot = findAvailableSlot(events, date, getEventDuration(candidate), {
    ignoreId: candidate.id,
  })
  if (!slot || slot.start === candidate.start) return null
  return {
    eventId: candidate.id,
    title: candidate.title,
    from: { start: candidate.start, end: candidate.end },
    to: slot,
  }
}

