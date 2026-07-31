import { describe, expect, it } from 'vitest'
import { parseStructuredAnswer } from './structuredAnswer'

describe('parseStructuredAnswer', () => {
  it('parses canonical markdown sections', () => {
    const result = parseStructuredAnswer(`## 结论
本次出差预算可控。

## 关键发现
- 酒店费用偏高

## 来源
- 出差计划.xlsx

## 下一步
- 确认酒店`)

    expect(result?.map((section) => section.kind)).toEqual([
      'summary',
      'findings',
      'sources',
      'actions',
    ])
    expect(result?.[0].content).toBe('本次出差预算可控。')
  })

  it('accepts numbered Chinese headings', () => {
    const result = parseStructuredAnswer(`1. 报告摘要
销售额增长。

2. 风险提醒
退款率偏高。

3. 下一步计划
检查退款订单。`)

    expect(result).toHaveLength(3)
    expect(result?.[1].kind).toBe('findings')
    expect(result?.[2].kind).toBe('actions')
  })

  it('falls back for ordinary chat text', () => {
    expect(parseStructuredAnswer('你好，我可以帮你分析文件。')).toBeNull()
  })
})
