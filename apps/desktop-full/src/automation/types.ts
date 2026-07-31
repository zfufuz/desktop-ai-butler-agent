export type ScheduledAgentJob = {
  id: string
  title: string
  prompt: string
  schedule: 'once' | 'daily' | 'weekly'
  time: string
  runDate?: string
  weekday?: number
  enabled: boolean
  status: 'idle' | 'running' | 'completed' | 'failed'
  nextRunAt?: number
  lastRunAt?: number
  lastResult?: string
  createdAt: number
  updatedAt: number
}

export type ScheduledAgentJobDraft = Pick<ScheduledAgentJob, 'title' | 'prompt' | 'schedule' | 'time'> &
  Partial<Pick<ScheduledAgentJob, 'id' | 'runDate' | 'weekday' | 'enabled'>>
