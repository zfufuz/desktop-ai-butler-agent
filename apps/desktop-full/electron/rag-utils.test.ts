import { describe, expect, it } from 'vitest'
import { compressKnowledgeContext, cosineSimilarity, decodeEmbeddingVector, encodeEmbeddingVector, rerankHybridCandidates } from './rag-utils'

describe('RAG utilities', () => {
  it('calculates cosine similarity', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
  })

  it('round-trips vectors through compact Float32 storage', () => {
    const original = [0.125, -0.75, 1]
    const encoded = encodeEmbeddingVector(original)
    const decoded = decodeEmbeddingVector(encoded, original.length)

    expect(encoded.byteLength).toBe(original.length * 4)
    expect(decoded).toEqual(original)
  })

  it('combines lexical and semantic signals before reranking', () => {
    const results = rerankHybridCandidates([
      { documentId: '1', documentName: 'A', chunkIndex: 0, content: '安装流程复杂', lexicalRank: 0 },
      { documentId: '2', documentName: 'B', chunkIndex: 0, content: '退款率偏高', lexicalRank: 1, vectorRank: 0, vectorScore: 0.95 },
    ], ['退款率'], 2)

    expect(results[0].documentId).toBe('2')
    expect(results[0].retrievalMode).toBe('hybrid')
  })

  it('compresses long chunks around query terms', () => {
    const content = `背景信息。${'无关说明。'.repeat(100)}退款率在七月明显升高。后续建议检查安装失败。`
    const compressed = compressKnowledgeContext(content, ['退款率', '安装失败'], 120)

    expect(compressed.length).toBeLessThanOrEqual(120)
    expect(compressed).toContain('退款率')
  })
})
