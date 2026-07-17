export type AiProvider = 'mock' | 'openai'

function getAiProvider(value: string | undefined): AiProvider {
  if (value === 'openai') {
    return 'openai'
  }

  return 'mock'
}

export const appConfig = {
  aiProvider: getAiProvider(import.meta.env.VITE_AI_PROVIDER),
  openaiApiKey: import.meta.env.VITE_OPENAI_API_KEY ?? '',
  openaiModel: import.meta.env.VITE_OPENAI_MODEL ?? 'gpt-4.1-mini',
}