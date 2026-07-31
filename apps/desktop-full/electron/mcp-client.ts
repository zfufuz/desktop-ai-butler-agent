import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

export type McpServerConnection = {
  command: string
  args: string[]
  cwd?: string
}

async function withClient<T>(server: McpServerConnection, action: (client: Client) => Promise<T>) {
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    cwd: server.cwd,
    stderr: 'pipe',
  })
  const client = new Client({ name: 'desktop-ai-butler', version: '0.1.0' })
  try {
    await client.connect(transport)
    return await action(client)
  } finally {
    await client.close().catch(() => undefined)
  }
}

export async function discoverMcpTools(server: McpServerConnection) {
  return withClient(server, async (client) => {
    const result = await client.listTools()
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? tool.name,
      inputSchema: tool.inputSchema,
    }))
  })
}

export async function callMcpTool(server: McpServerConnection, toolName: string, input: Record<string, unknown>) {
  return withClient(server, async (client) => {
    const result = await client.callTool({ name: toolName, arguments: input })
    const content = Array.isArray(result.content)
      ? result.content as Array<{ type: string; text?: string }>
      : []
    const text = content
      .map((item) => item.type === 'text' ? item.text ?? '' : JSON.stringify(item))
      .join('\n')
      .trim()
    return { content: text || JSON.stringify(result.structuredContent ?? {}), isError: Boolean(result.isError) }
  })
}
