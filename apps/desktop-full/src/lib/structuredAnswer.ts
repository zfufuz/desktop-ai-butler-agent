export type StructuredAnswerSection = {
  kind: 'summary' | 'findings' | 'sources' | 'actions' | 'other'
  title: string
  content: string
}

const sectionMatchers: Array<{
  kind: StructuredAnswerSection['kind']
  title: string
  pattern: RegExp
}> = [
  { kind: 'summary', title: '结论', pattern: /结论|摘要|概述|结果|总结/ },
  { kind: 'findings', title: '关键发现', pattern: /关键发现|发现|重点|风险|问题|分析/ },
  { kind: 'sources', title: '来源', pattern: /来源|依据|参考|引用|数据源/ },
  { kind: 'actions', title: '下一步', pattern: /下一步|建议|行动|待办|计划/ },
]

function matchSectionHeading(line: string) {
  const trimmed = line.trim()
  const hasHeadingSyntax =
    /^#{1,6}\s+/.test(trimmed) ||
    /^\d+[.、)]\s*/.test(trimmed) ||
    /^\*\*[^*]+\*\*\s*[：:]?$/.test(trimmed)

  const normalized = line
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\d+[.、)]\s*/, '')
    .replace(/[：:]\s*$/, '')
    .replace(/\*\*/g, '')
    .trim()

  if (!normalized || normalized.length > 24) return null
  const match = sectionMatchers.find((item) => item.pattern.test(normalized))
  const isCanonicalHeading = sectionMatchers.some((item) => (
    normalized === item.title ||
    normalized === `${item.title}说明` ||
    normalized === `${item.title}计划`
  ))
  if (!hasHeadingSyntax && !isCanonicalHeading) return null
  return match ? { ...match, originalTitle: normalized } : null
}

export function parseStructuredAnswer(content: string): StructuredAnswerSection[] | null {
  const lines = content.split(/\r?\n/)
  const sections: StructuredAnswerSection[] = []
  let current: StructuredAnswerSection | null = null
  const preamble: string[] = []

  const flushCurrent = () => {
    if (!current) return
    current.content = current.content.trim()
    if (current.content) sections.push(current)
    current = null
  }

  for (const line of lines) {
    const heading = matchSectionHeading(line)
    if (heading) {
      flushCurrent()
      current = {
        kind: heading.kind,
        title: heading.kind === 'other' ? heading.originalTitle : heading.title,
        content: '',
      }
      continue
    }

    if (current) {
      current.content += `${line}\n`
    } else {
      preamble.push(line)
    }
  }
  flushCurrent()

  if (sections.length < 2) return null

  const preambleContent = preamble.join('\n').trim()
  if (preambleContent && !sections.some((section) => section.kind === 'summary')) {
    sections.unshift({ kind: 'summary', title: '结论', content: preambleContent })
  }

  return sections
}
