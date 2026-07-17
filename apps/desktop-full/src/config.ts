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
