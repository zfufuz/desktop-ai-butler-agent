import type { AgentToolDefinition } from './protocol'

export type ToolName = 'getSystemInfo' | 'getAppVersion' | 'pickTextFile' | 'queryKnowledgeBase'

export type ToolDefinition = AgentToolDefinition<ToolName>

export const toolRegistry: ToolDefinition[] = [
  {
    name: 'getSystemInfo',
    label: '读取开发环境',
    description: '获取当前电脑的操作系统、CPU 架构和核心数，用于判断开发与运行环境。',
    riskLevel: 'low',
    requiresPermission: false,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'getAppVersion',
    label: '读取应用版本',
    description: '获取开发者桌面 Agent 的应用版本号。',
    riskLevel: 'low',
    requiresPermission: false,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'pickTextFile',
    label: '读取项目文件',
    description: '打开系统文件选择器，读取本地文本、Office、PDF、图片元信息、日志、JSON、CSV 或代码文件。',
    riskLevel: 'medium',
    requiresPermission: true,
    inputSchema: {
      type: 'object',
      properties: {
        purpose: { type: 'string', description: '为什么需要用户选择并读取文件' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'queryKnowledgeBase',
    label: '检索项目知识库',
    description: '从用户导入的本地项目资料中检索相关内容，用于 RAG 回答。',
    riskLevel: 'low',
    requiresPermission: false,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '用于检索本地知识库的问题或关键词' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
]

export function getToolDefinition(toolName: ToolName) {
  return toolRegistry.find((tool) => tool.name === toolName)
}
