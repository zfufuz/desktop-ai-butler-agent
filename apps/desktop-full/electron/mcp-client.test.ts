import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { callMcpTool, discoverMcpTools } from './mcp-client'

const exampleServer = path.join(
  process.cwd(),
  'node_modules',
  '@modelcontextprotocol',
  'sdk',
  'dist',
  'esm',
  'examples',
  'server',
  'mcpServerOutputSchema.js',
)

describe('MCP stdio client', () => {
  it('discovers and calls a real MCP tool', async () => {
    const connection = { command: process.execPath, args: [exampleServer] }
    const tools = await discoverMcpTools(connection)
    expect(tools.some((tool) => tool.name === 'get_weather')).toBe(true)

    const result = await callMcpTool(connection, 'get_weather', { city: 'Hangzhou', country: 'CN' })
    expect(result.isError).toBe(false)
    expect(result.content).toContain('temperature')
  }, 15_000)
})
