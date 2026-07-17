import { appConfig } from '../config'

export type AssistantReply = {
  content: string
}

export async function createAssistantReply(userText: string): Promise<AssistantReply> {
  if (appConfig.aiProvider === 'mock') {
    return {
      content: `收到：${userText}\n\n当前是本地演示模式。切换到智谱模式后，我会通过 Electron 主进程调用真实 AI。`,
    }
  }

  if (!window.electronAPI?.sendChatMessage) {
    return { content: '当前不在 Electron 环境中，无法调用桌面 AI 服务。请使用 npm run dev:electron 启动。' }
  }

  return window.electronAPI.sendChatMessage(userText)
}

export async function streamAssistantReply(
  userText: string,
  onDelta: (delta: string) => void,
): Promise<AssistantReply> {
  if (appConfig.aiProvider === 'mock' || !window.electronAPI?.streamChatMessage) {
    const reply = await createAssistantReply(userText)
    onDelta(reply.content)
    return reply
  }

  return window.electronAPI.streamChatMessage(userText, onDelta)
}
