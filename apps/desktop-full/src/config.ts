// 前端演示配置：集中读取 Vite 环境变量并选择默认模型 Provider。
export type AiProvider = 'mock' | 'zhipu'

function getAiProvider(value: string | undefined): AiProvider {
  if (value === 'zhipu') {
    return 'zhipu'
  }

  return 'mock'
}

export const appConfig = {
  aiProvider: getAiProvider(import.meta.env.VITE_AI_PROVIDER),
  aiModel: import.meta.env.VITE_AI_MODEL ?? 'glm-4-flash',
}
