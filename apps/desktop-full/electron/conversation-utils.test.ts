import { describe, expect, it } from 'vitest'
import { deriveConversationTitle, normalizeConversationMessages } from './conversation-utils'

describe('conversation utils', () => {
  it('normalizes valid messages and drops empty content', () => {
    const messages = normalizeConversationMessages([
      { id: 1, role: 'user', content: '  hello  ', createdAt: 10 },
      { id: 2, role: 'assistant', content: '', createdAt: 11 },
    ])

    expect(messages).toEqual([{ id: 1, role: 'user', content: 'hello', createdAt: 10 }])
  })

  it('uses the first user message as a bounded title', () => {
    const messages = normalizeConversationMessages([
      { id: 1, role: 'assistant', content: 'welcome', createdAt: 10 },
      { id: 2, role: 'user', content: '请帮我分析这份很长很长很长很长很长很长的项目文件', createdAt: 11 },
    ])

    expect(deriveConversationTitle(messages)).toMatch(/^请帮我分析/)
    expect(deriveConversationTitle(messages).length).toBeLessThanOrEqual(31)
  })
})
