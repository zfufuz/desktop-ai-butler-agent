import { appConfig } from '../config'
export type AssistantReply = {
  content: string
}

export async function createAssistantReply(userText: string): Promise<AssistantReply> {
  if (appConfig.aiProvider === 'mock') {
    return { content: `收到：${userText}。当前是模拟 AI 模式。` }
  }

  return { content: `真实 AI 模式还没接入。当前模型：${appConfig.openaiModel}` }
}