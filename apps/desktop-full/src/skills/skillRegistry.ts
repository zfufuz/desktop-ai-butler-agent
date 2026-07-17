import { runAgent, type AgentTimelineStep, type KnowledgeDocument, type ToolCallLog } from '../services/agent'
import { createAssistantReply, type AssistantReply } from '../services/assistant'

export type SkillId = 'projectBriefing' | 'dailyReport' | 'debugChecklist' | 'readmeDraft'

export type SkillContext = {
  userInput: string
  messages: string[]
  toolLogs: ToolCallLog[]
  timeline: AgentTimelineStep[]
  knowledgeDocuments: KnowledgeDocument[]
  memoryNotes: string[]
  addToolLog: (log: ToolCallLog) => void
  addTimelineStep: (step: AgentTimelineStep) => void
  requestPermission: (toolName: string, reason: string) => Promise<boolean> | boolean
}

export type SkillDefinition = {
  id: SkillId
  name: string
  description: string
  inputHint: string
  requiredTools: string[]
  run: (context: SkillContext) => Promise<AssistantReply>
}

function formatRecentItems(items: string[], fallback: string) {
  return items.length > 0 ? items.slice(-8).join('\n') : fallback
}

export const skillRegistry: SkillDefinition[] = [
  {
    id: 'projectBriefing',
    name: '项目讲解 Skill',
    description: '面向面试场景，自动组织项目定位、架构、Agent 亮点和可讲述话术。',
    inputHint: '可补充目标岗位或面试方向',
    requiredTools: ['queryKnowledgeBase', 'getSystemInfo', 'getAppVersion'],
    async run(context) {
      return runAgent(
        `请以面试项目讲解的角度，总结这个“开发者桌面 Agent”项目。

补充要求：${context.userInput || '偏工程实现、Agent 架构、本地工具调用、RAG 和桌面端安全能力。'}

最近对话：
${formatRecentItems(context.messages, '暂无')}

长期记忆：
${formatRecentItems(context.memoryNotes, '暂无')}`,
        context.addToolLog,
        {
          knowledgeDocuments: context.knowledgeDocuments,
          onTimeline: context.addTimelineStep,
          requestPermission: context.requestPermission,
        },
      )
    },
  },
  {
    id: 'dailyReport',
    name: '开发日报 Skill',
    description: '读取工具日志和执行轨迹，生成结构化开发日报。',
    inputHint: '可补充今天重点',
    requiredTools: ['getAppVersion'],
    async run(context) {
      return createAssistantReply(
        `请生成一份“开发者桌面 Agent”项目的开发日报。

用户补充：${context.userInput || '无'}

工具调用日志：
${context.toolLogs.map((log) => `- ${log.name}: ${log.detail}`).join('\n') || '暂无'}

Agent 执行轨迹：
${context.timeline.map((step) => `- ${step.title}: ${step.detail}`).join('\n') || '暂无'}

请按以下结构输出：
1. 今日完成
2. 当前问题
3. 明日计划
4. 可用于简历的技术表述`,
      )
    },
  },
  {
    id: 'debugChecklist',
    name: '排错清单 Skill',
    description: '根据运行环境、工具日志和错误现象生成排查步骤。',
    inputHint: '可输入报错现象',
    requiredTools: ['getSystemInfo'],
    async run(context) {
      return runAgent(
        `请根据当前“开发者桌面 Agent”项目生成故障排查清单。

用户描述：${context.userInput || '未提供具体报错'}

已有工具日志：
${context.toolLogs.map((log) => `- ${log.name}: ${log.status} ${log.detail}`).join('\n') || '暂无'}

要求：按优先级列出排查步骤，并说明每一步为什么要做。`,
        context.addToolLog,
        {
          knowledgeDocuments: context.knowledgeDocuments,
          onTimeline: context.addTimelineStep,
          requestPermission: context.requestPermission,
        },
      )
    },
  },
  {
    id: 'readmeDraft',
    name: 'README 生成 Skill',
    description: '结合知识库和当前项目目标，生成适合 GitHub 与简历展示的 README 草稿。',
    inputHint: '可补充想强调的模块',
    requiredTools: ['queryKnowledgeBase', 'getAppVersion'],
    async run(context) {
      return runAgent(
        `请为“开发者桌面 Agent”生成 README 草稿，重点突出：
1. 项目解决什么开发者问题
2. Electron + React + TypeScript 架构
3. Agent Loop、工具调用、RAG、Skill Registry
4. 权限、安全边界和可演示流程
5. 后续可扩展方向

用户补充：${context.userInput || '无'}`,
        context.addToolLog,
        {
          knowledgeDocuments: context.knowledgeDocuments,
          onTimeline: context.addTimelineStep,
          requestPermission: context.requestPermission,
        },
      )
    },
  },
]

export function getSkillDefinition(skillId: SkillId) {
  return skillRegistry.find((skill) => skill.id === skillId)
}
