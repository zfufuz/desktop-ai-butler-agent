export type HybridCandidate = {
  documentId: string
  documentName: string
  chunkIndex: number
  content: string
  lexicalRank?: number
  vectorRank?: number
  vectorScore?: number
}

export type HybridResult = HybridCandidate & {
  score: number
  lexicalScore: number
  semanticScore: number
  retrievalMode: 'keyword' | 'hybrid'
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || left.length !== right.length) return 0
  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftMagnitude += left[index] ** 2
    rightMagnitude += right[index] ** 2
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude))
}

export function encodeEmbeddingVector(vector: number[]) {
  return new Uint8Array(new Float32Array(vector).buffer)
}

export function decodeEmbeddingVector(blob: Uint8Array, dimensions: number) {
  const bytes = Uint8Array.from(blob)
  return Array.from(new Float32Array(bytes.buffer, 0, dimensions))
}

function termCoverage(content: string, queryTerms: string[]) {
  if (queryTerms.length === 0) return 0
  const normalized = content.toLowerCase()
  const hits = queryTerms.filter((term) => normalized.includes(term.toLowerCase())).length
  return hits / queryTerms.length
}

export function rerankHybridCandidates(
  candidates: HybridCandidate[],
  queryTerms: string[],
  limit = 5,
): HybridResult[] {
  return candidates
    .map((candidate) => {
      const lexicalScore = candidate.lexicalRank === undefined ? 0 : 1 / (candidate.lexicalRank + 1)
      const semanticScore = candidate.vectorScore === undefined
        ? 0
        : Math.max(0, Math.min(1, (candidate.vectorScore + 1) / 2))
      const coverage = termCoverage(candidate.content, queryTerms)
      const hasVector = candidate.vectorRank !== undefined
      const score = hasVector
        ? semanticScore * 0.5 + lexicalScore * 0.3 + coverage * 0.2
        : lexicalScore * 0.75 + coverage * 0.25

      return {
        ...candidate,
        score: Number(score.toFixed(6)),
        lexicalScore: Number(lexicalScore.toFixed(6)),
        semanticScore: Number(semanticScore.toFixed(6)),
        retrievalMode: hasVector ? 'hybrid' as const : 'keyword' as const,
      }
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, limit))
}

export function compressKnowledgeContext(content: string, queryTerms: string[], maxLength = 700) {
  if (content.length <= maxLength) return content
  const sentences = content
    .split(/(?<=[。！？!?\n])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
  if (sentences.length <= 1) return content.slice(0, maxLength)

  const ranked = sentences.map((sentence, index) => ({
    sentence,
    index,
    coverage: termCoverage(sentence, queryTerms),
  }))
  const selected = new Set<number>([0])
  for (const item of ranked.sort((left, right) => right.coverage - left.coverage || left.index - right.index)) {
    if (item.coverage === 0 && selected.size >= 2) break
    selected.add(item.index)
    const currentLength = [...selected].reduce((sum, index) => sum + sentences[index].length, 0)
    if (currentLength >= maxLength) break
  }

  return [...selected]
    .sort((left, right) => left - right)
    .map((index) => sentences[index])
    .join('\n')
    .slice(0, maxLength)
}
