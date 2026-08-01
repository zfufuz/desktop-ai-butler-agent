import { describe, expect, it } from 'vitest'
import { isToolRelevantToRequest } from './agent'

describe('agent tool relevance guard', () => {
  it('rejects system info for a general capability question', () => {
    expect(isToolRelevantToRequest('getSystemInfo', '您能干什么')).toBe(false)
  })

  it('allows system info only when the request mentions the computer environment', () => {
    expect(isToolRelevantToRequest('getSystemInfo', '查看这台电脑的 CPU 和系统环境')).toBe(true)
  })

  it('does not confuse a generic app question with an app version request', () => {
    expect(isToolRelevantToRequest('getAppVersion', '这个应用能做什么')).toBe(false)
    expect(isToolRelevantToRequest('getAppVersion', '当前管家版本号是多少')).toBe(true)
  })
})
