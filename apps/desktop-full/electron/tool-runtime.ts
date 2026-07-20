export type ToolParameterType = 'string' | 'number' | 'boolean'

export type ToolInputSchema = {
  properties: Record<string, { type: ToolParameterType; description?: string }>
  required?: string[]
}

export type ToolRequestMapping = Record<string, string>

type RuntimeTool = {
  endpoint: string
  method: 'GET' | 'POST'
  apiKey?: string
  apiKeyPlacement?: 'none' | 'bearer' | 'query' | 'header'
  apiKeyName?: string
  headers?: Record<string, string>
  inputSchema?: ToolInputSchema
  queryParams?: ToolRequestMapping
  bodyParams?: ToolRequestMapping
  responsePath?: string
}

function extractLegacyVariables(input: string) {
  const cityMatch = input.match(/(?:今天|明天|后天)?([^，。,.?\s]{2,12})(?:的)?天气/)
    ?? input.match(/天气.*?(?:在|查|看)?([^，。,.?\s]{2,12})/)
  const routeMatch = input.match(/(-?\d{2,3}(?:\.\d+)?\s*,\s*-?\d{1,2}(?:\.\d+)?)\s*(?:到|至|->|→)\s*(-?\d{2,3}(?:\.\d+)?\s*,\s*-?\d{1,2}(?:\.\d+)?)/)
  return {
    input,
    query: input,
    city: cityMatch?.[1]?.replace(/我想|帮我|查询|看看|今天|明天|后天/g, '') || input,
    origin: routeMatch?.[1]?.replace(/\s/g, '') || input,
    destination: routeMatch?.[2]?.replace(/\s/g, '') || input,
  } as Record<string, string | number | boolean>
}

export function parseToolInput(input: string) {
  const variables = extractLegacyVariables(input)
  try {
    const parsed = JSON.parse(input) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) Object.assign(variables, parsed)
  } catch {
    // Plain-language input remains available through input/query and legacy variables.
  }
  return variables
}

function coerceValue(value: unknown, type: ToolParameterType) {
  if (type === 'number') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : value
  }
  if (type === 'boolean') {
    if (value === true || value === 'true') return true
    if (value === false || value === 'false') return false
  }
  return value
}

export function validateToolVariables(schema: ToolInputSchema | undefined, variables: Record<string, unknown>) {
  if (!schema) return variables
  const normalized = { ...variables }
  for (const [key, definition] of Object.entries(schema.properties)) {
    if (key in normalized) normalized[key] = coerceValue(normalized[key], definition.type)
  }
  for (const key of schema.required ?? []) {
    const value = normalized[key]
    if (value === undefined || value === null || String(value).trim() === '') throw new Error(`Tool 缺少必填参数：${key}`)
  }
  for (const [key, definition] of Object.entries(schema.properties)) {
    const value = normalized[key]
    if (value === undefined) continue
    if (definition.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`Tool 参数 ${key} 必须是数字`)
    if (definition.type === 'boolean' && typeof value !== 'boolean') throw new Error(`Tool 参数 ${key} 必须是布尔值`)
    if (definition.type === 'string' && typeof value !== 'string') throw new Error(`Tool 参数 ${key} 必须是字符串`)
  }
  return normalized
}

export function applyRuntimeTemplate(template: string, variables: Record<string, unknown>) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => encodeURIComponent(String(variables[key] ?? '')))
}

function mapValues(mapping: ToolRequestMapping | undefined, variables: Record<string, unknown>) {
  if (!mapping) return {}
  return Object.fromEntries(Object.entries(mapping).map(([target, source]) => {
    const direct = variables[source]
    return [target, direct === undefined ? applyRuntimeTemplate(source, variables) : direct]
  }))
}

export function prepareToolRequest(tool: RuntimeTool, input: string) {
  const variables = validateToolVariables(tool.inputSchema, {
    ...parseToolInput(input),
    apiKey: tool.apiKey ?? '',
  })
  const endpoint = new URL(applyRuntimeTemplate(tool.endpoint, variables))
  const query = mapValues(tool.queryParams, variables)
  for (const [key, value] of Object.entries(query)) endpoint.searchParams.set(key, String(value))
  if (tool.apiKey && tool.apiKeyPlacement === 'query' && !endpoint.searchParams.has(tool.apiKeyName || 'key')) {
    endpoint.searchParams.set(tool.apiKeyName || 'key', tool.apiKey)
  }
  const headers = Object.fromEntries(Object.entries(tool.headers ?? {}).map(([key, value]) => [
    key,
    applyRuntimeTemplate(value, variables),
  ]))
  const body = tool.method === 'POST'
    ? Object.keys(tool.bodyParams ?? {}).length > 0 ? mapValues(tool.bodyParams, variables) : variables
    : undefined
  return { endpoint: endpoint.toString(), headers, body, variables }
}

export function getValueAtPath(value: unknown, path?: string): unknown {
  if (!path?.trim()) return value
  return path.split('.').filter(Boolean).reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current) && /^\d+$/.test(segment)) return current[Number(segment)]
    if (typeof current === 'object') return (current as Record<string, unknown>)[segment]
    return undefined
  }, value)
}

export function extractToolResponse(text: string, responsePath?: string) {
  if (!responsePath?.trim()) return text
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('Tool 响应不是 JSON，无法按路径提取')
  }
  const extracted = getValueAtPath(payload, responsePath)
  if (extracted === undefined) throw new Error(`Tool 响应中不存在路径：${responsePath}`)
  return typeof extracted === 'string' ? extracted : JSON.stringify(extracted, null, 2)
}

export function hasToolBusinessError(text: string) {
  return /"status"\s*:\s*"?0|"success"\s*:\s*false|ENGINE_RESPONSE_DATA_ERROR|INVALID_USER_KEY|"infocode"\s*:\s*"?3\d+/i.test(text)
}
