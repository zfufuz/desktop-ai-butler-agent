export type AutomationSchedule = 'once' | 'daily' | 'weekly'

export type AutomationTiming = {
  schedule: AutomationSchedule
  time: string
  runDate?: string
  weekday?: number
}

function atLocalTime(date: Date, time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  const result = new Date(date)
  result.setHours(hours, minutes, 0, 0)
  return result
}

export function calculateNextAutomationRun(timing: AutomationTiming, from = new Date()) {
  if (timing.schedule === 'once') {
    if (!timing.runDate) return undefined
    const runAt = new Date(`${timing.runDate}T${timing.time}:00`)
    return runAt.getTime() > from.getTime() ? runAt.getTime() : undefined
  }

  if (timing.schedule === 'daily') {
    const candidate = atLocalTime(from, timing.time)
    if (candidate.getTime() <= from.getTime()) candidate.setDate(candidate.getDate() + 1)
    return candidate.getTime()
  }

  const weekday = Math.max(0, Math.min(6, Number(timing.weekday) || 0))
  const candidate = atLocalTime(from, timing.time)
  const daysAhead = (weekday - candidate.getDay() + 7) % 7
  candidate.setDate(candidate.getDate() + daysAhead)
  if (candidate.getTime() <= from.getTime()) candidate.setDate(candidate.getDate() + 7)
  return candidate.getTime()
}
