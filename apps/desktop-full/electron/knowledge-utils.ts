export function chunkKnowledgeContent(content: string, maxLength = 1200, overlap = 160) {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!normalized) return []

  const chunks: string[] = []
  let start = 0
  while (start < normalized.length && chunks.length < 300) {
    let end = Math.min(normalized.length, start + maxLength)
    if (end < normalized.length) {
      const candidate = normalized.slice(start + Math.floor(maxLength * 0.6), end)
      const boundary = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf('。'), candidate.lastIndexOf('. '))
      if (boundary > 0) end = start + Math.floor(maxLength * 0.6) + boundary + 1
    }
    const chunk = normalized.slice(start, end).trim()
    if (chunk) chunks.push(chunk)
    if (end >= normalized.length) break
    start = Math.max(start + 1, end - overlap)
  }
  return chunks
}

export function createKnowledgeSearchTerms(query: string) {
  const terms = new Set<string>()
  for (const word of query.toLowerCase().match(/[a-z0-9_-]{3,}/g) ?? []) terms.add(word)
  for (const sequence of query.match(/[\u3400-\u9fff]{3,}/g) ?? []) {
    if (sequence.length <= 6) terms.add(sequence)
    for (let index = 0; index <= sequence.length - 3 && terms.size < 16; index += 1) {
      terms.add(sequence.slice(index, index + 3))
    }
  }
  return [...terms].slice(0, 16)
}
