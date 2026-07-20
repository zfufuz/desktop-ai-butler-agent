import { describe, expect, it } from 'vitest'
import { extractToolResponse, getValueAtPath, hasToolBusinessError, prepareToolRequest, validateToolVariables } from './tool-runtime'

describe('tool runtime', () => {
  it('validates and coerces schema parameters', () => {
    expect(validateToolVariables({ properties: { days: { type: 'number' } }, required: ['days'] }, { days: '3' })).toMatchObject({ days: 3 })
    expect(() => validateToolVariables({ properties: { city: { type: 'string' } }, required: ['city'] }, {})).toThrow('city')
  })

  it('maps query, body, headers and query api key', () => {
    const request = prepareToolRequest({
      endpoint: 'https://example.com/weather/{{city}}', method: 'POST', apiKey: 'secret', apiKeyPlacement: 'query', apiKeyName: 'token',
      headers: { 'X-City': '{{city}}' }, queryParams: { units: '{{unit}}' }, bodyParams: { days: 'days' },
      inputSchema: { properties: { city: { type: 'string' }, unit: { type: 'string' }, days: { type: 'number' } }, required: ['city'] },
    }, '{"city":"上海","unit":"metric","days":3}')
    expect(request.endpoint).toContain('/weather/%E4%B8%8A%E6%B5%B7')
    expect(request.endpoint).toContain('token=secret')
    expect(request.body).toEqual({ days: 3 })
    expect(request.headers['X-City']).toBe('%E4%B8%8A%E6%B5%B7')
  })

  it('extracts nested response data and detects business errors', () => {
    const payload = { data: { items: [{ name: 'A' }] } }
    expect(getValueAtPath(payload, 'data.items.0.name')).toBe('A')
    expect(extractToolResponse(JSON.stringify(payload), 'data.items.0')).toContain('"name": "A"')
    expect(hasToolBusinessError('{"status":"0","infocode":"30001"}')).toBe(true)
  })
})
