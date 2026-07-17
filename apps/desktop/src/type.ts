export type Message = {
  id: number
  role: 'user' | 'assistant'
  content: string
  createdAt: number

}

export type AssistantStatus = 'idle' | 'thinking'