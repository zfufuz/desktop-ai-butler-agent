export type McpToolSummary = {
  name: string
  description: string
  inputSchema: {
    type?: string
    properties?: Record<string, { type?: string; description?: string }>
    required?: string[]
  }
}

export type McpServerConfig = {
  id: string
  name: string
  command: string
  args: string[]
  cwd?: string
  enabled: boolean
  tools: McpToolSummary[]
  status: 'unknown' | 'connected' | 'error'
  lastError?: string
  createdAt: number
  updatedAt: number
}

export type McpServerDraft = Pick<McpServerConfig, 'name' | 'command'> &
  Partial<Pick<McpServerConfig, 'id' | 'args' | 'cwd' | 'enabled'>>
