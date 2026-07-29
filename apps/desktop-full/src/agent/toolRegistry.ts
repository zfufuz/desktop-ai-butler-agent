// 内置 Tool 注册表：声明 Agent 可选择的工具名称、用途、风险和输入 Schema。
import type { AgentToolDefinition } from './protocol'

export type ToolName =
  | 'getSystemInfo'
  | 'getAppVersion'
  | 'pickTextFile'
  | 'queryKnowledgeBase'
  | 'listSchedule'
  | 'findFreeTime'
  | 'createScheduleEvent'

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
  {
    name: 'listSchedule',
    label: '查看时间安排',
    description: '读取指定日期的本地日程，用于回答今天有什么安排、下一项任务是什么。日期格式为 YYYY-MM-DD。',
    riskLevel: 'low',
    requiresPermission: false,
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '要查询的日期，格式为 YYYY-MM-DD' },
      },
      required: ['date'],
      additionalProperties: false,
    },
  },
  {
    name: 'findFreeTime',
    label: '查找空闲时间',
    description: '根据已有日程，在指定日期工作时段内查找可用空档。只计算，不写入数据。',
    riskLevel: 'low',
    requiresPermission: false,
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '目标日期，格式为 YYYY-MM-DD' },
        durationMinutes: { type: 'number', description: '需要的连续分钟数' },
      },
      required: ['date', 'durationMinutes'],
      additionalProperties: false,
    },
  },
  {
    name: 'createScheduleEvent',
    label: '创建日程',
    description: '把任务或计划安排到本地日历。写入前需要用户确认，遇到冲突时自动寻找相同日期的可用空档。',
    riskLevel: 'medium',
    requiresPermission: true,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '日程标题' },
        description: { type: 'string', description: '日程说明' },
        date: { type: 'string', description: '日期，格式为 YYYY-MM-DD' },
        start: { type: 'string', description: '开始时间，格式为 HH:mm' },
        end: { type: 'string', description: '结束时间，格式为 HH:mm' },
        category: { type: 'string', description: '类型：focus、meeting、life 或 deadline' },
        flexible: { type: 'boolean', description: '发生冲突时是否允许调整到空档' },
      },
      required: ['title', 'date', 'start', 'end'],
      additionalProperties: false,
    },
  },
]

export function getToolDefinition(toolName: ToolName) {
  return toolRegistry.find((tool) => tool.name === toolName)
}
