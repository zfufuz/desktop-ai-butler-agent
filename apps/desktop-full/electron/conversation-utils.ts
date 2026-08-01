export type StoredConversationMessage = {
  id: number
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

export function normalizeConversationMessages(value: unknown): StoredConversationMessage[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item, index) => ({
      id: typeof item.id === 'number' && Number.isFinite(item.id) ? item.id : Date.now() + index / 1000,
      role: item.role === 'user' ? 'user' as const : 'assistant' as const,
      content: typeof item.content === 'string' ? item.content.trim().slice(0, 100_000) : '',
      createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
    }))
    .filter((item) => item.content.length > 0)
    .slice(-500)
}

export function deriveConversationTitle(messages: StoredConversationMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === 'user')?.content
  if (!firstUserMessage) return '新对话'

  const title = firstUserMessage.replace(/\s+/g, ' ').trim()
  return title.length > 28 ? `${title.slice(0, 28)}...` : title
}
