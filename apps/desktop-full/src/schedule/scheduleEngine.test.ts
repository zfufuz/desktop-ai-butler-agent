import { describe, expect, it } from 'vitest'
import {
  calculateScheduleBudget,
  eventsOverlap,
  findAvailableSlot,
  findScheduleConflicts,
  proposeSmartReplan,
  type ScheduleEvent,
} from './scheduleEngine'

function event(patch: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    id: patch.id ?? 'event-1',
    title: patch.title ?? '默认日程',
    description: '',
    date: patch.date ?? '2026-07-30',
    start: patch.start ?? '09:00',
    end: patch.end ?? '10:00',
    category: patch.category ?? 'focus',
    priority: patch.priority ?? 'medium',
    flexible: patch.flexible ?? true,
    progress: patch.progress ?? 0,
    status: patch.status ?? 'active',
    recurrence: patch.recurrence ?? 'none',
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('scheduleEngine', () => {
  it('detects real overlaps but allows adjacent events', () => {
    expect(eventsOverlap(event(), event({ id: 'event-2', start: '09:30', end: '10:30' }))).toBe(true)
    expect(eventsOverlap(event(), event({ id: 'event-2', start: '10:00', end: '11:00' }))).toBe(false)
  })

  it('returns structured conflicts and ignores completed events', () => {
    const candidate = event({ id: 'candidate', start: '09:30', end: '10:15' })
    const conflicts = findScheduleConflicts([
      event({ title: '晨会' }),
      event({ id: 'done', status: 'done', start: '09:30', end: '10:30' }),
    ], candidate)
    expect(conflicts).toEqual([{ eventId: 'event-1', title: '晨会', start: '09:00', end: '10:00' }])
  })

  it('finds the first available slot inside working hours', () => {
    const slot = findAvailableSlot([
      event({ start: '08:00', end: '09:00' }),
      event({ id: 'event-2', start: '09:00', end: '10:00' }),
    ], '2026-07-30', 60)
    expect(slot).toEqual({ start: '10:00', end: '11:00' })
  })

  it('calculates daily load from active events', () => {
    const budget = calculateScheduleBudget([
      event({ start: '09:00', end: '11:00' }),
      event({ id: 'event-2', start: '13:00', end: '14:00' }),
      event({ id: 'done', start: '14:00', end: '15:00', status: 'done' }),
    ], '2026-07-30', '09:00', '18:00')
    expect(budget).toEqual({
      scheduledMinutes: 180,
      availableMinutes: 540,
      remainingMinutes: 360,
      loadPercent: 33,
    })
  })

  it('proposes moving a flexible low-priority event', () => {
    const proposal = proposeSmartReplan([
      event({ id: 'fixed', title: '固定晨会', start: '08:00', end: '09:00', flexible: false, priority: 'high' }),
      event({ id: 'movable', title: '整理资料', start: '11:00', end: '12:00', flexible: true, priority: 'low' }),
    ], '2026-07-30')
    expect(proposal).toEqual({
      eventId: 'movable',
      title: '整理资料',
      from: { start: '11:00', end: '12:00' },
      to: { start: '09:00', end: '10:00' },
    })
  })
})

