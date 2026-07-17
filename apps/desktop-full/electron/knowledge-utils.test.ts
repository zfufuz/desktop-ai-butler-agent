import { describe, expect, it } from 'vitest'
import { chunkKnowledgeContent, createKnowledgeSearchTerms } from './knowledge-utils'

describe('knowledge utilities', () => {
  it('splits long content into bounded overlapping chunks', () => {
    const content = Array.from({ length: 80 }, (_, index) => `第 ${index + 1} 条记录：客户反馈安装流程复杂。`).join('\n')
    const chunks = chunkKnowledgeContent(content, 240, 40)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= 240)).toBe(true)
    expect(chunks.join('')).toContain('安装流程复杂')
  })

  it('creates Chinese trigrams and normalized Latin search terms', () => {
    const terms = createKnowledgeSearchTerms('分析退款原因 API_ERROR')

    expect(terms).toContain('退款原')
    expect(terms).toContain('api_error')
    expect(terms.length).toBeLessThanOrEqual(16)
  })
})
