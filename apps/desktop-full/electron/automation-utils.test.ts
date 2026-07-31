import { describe, expect, it } from 'vitest'
import { calculateNextAutomationRun } from './automation-utils'

describe('calculateNextAutomationRun', () => {
  const mondayMorning = new Date('2026-07-27T09:30:00')

  it('keeps a future one-off run', () => {
    expect(calculateNextAutomationRun({ schedule: 'once', runDate: '2026-07-28', time: '10:00' }, mondayMorning))
      .toBe(new Date('2026-07-28T10:00:00').getTime())
  })

  it('does not repeat an expired one-off run', () => {
    expect(calculateNextAutomationRun({ schedule: 'once', runDate: '2026-07-26', time: '10:00' }, mondayMorning))
      .toBeUndefined()
  })

  it('moves a passed daily time to tomorrow', () => {
    expect(calculateNextAutomationRun({ schedule: 'daily', time: '09:00' }, mondayMorning))
      .toBe(new Date('2026-07-28T09:00:00').getTime())
  })

  it('finds the next weekly weekday', () => {
    expect(calculateNextAutomationRun({ schedule: 'weekly', weekday: 3, time: '08:00' }, mondayMorning))
      .toBe(new Date('2026-07-29T08:00:00').getTime())
  })
})
