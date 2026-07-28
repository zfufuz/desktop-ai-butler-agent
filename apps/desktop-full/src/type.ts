// 聊天界面的基础领域类型，供消息列表和主应用状态共同使用。
export type Message = {
  id: number
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

export type AssistantStatus = 'idle' | 'thinking'
