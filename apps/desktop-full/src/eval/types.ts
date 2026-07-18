export type EvalCategory = 'file' | 'tool' | 'rag' | 'permission' | 'plan'

export interface EvalCase {
  id: string
  category: EvalCategory
  prompt: string
  expectedTools?: string[]
  expectedParams?: Record<string, unknown>
  relevantDocumentIds?: string[]
  expectedKeywords?: string[]
  expectedOutcome: string
}

export interface EvalResult {
  caseId: string
  passed: boolean
  selectedTools: string[]
  toolParams?: Record<string, unknown>
  retrievedDocumentIds: string[]
  citedDocumentIds: string[]
  supportedClaims: number
  totalClaims: number
  turns: number
  firstTokenMs: number
  durationMs: number
  inputTokens: number
  outputTokens: number
  cost: number
  output: string
}

export interface EvalMetrics {
  totalCases: number
  taskCompletionRate: number
  toolSelectionAccuracy: number
  toolParameterAccuracy: number
  recallAt5: number
  mrr: number
  ndcgAt5: number
  citationAccuracy: number
  hallucinationRate: number
  averageTurns: number
  averageFirstTokenMs: number
  p50ResponseMs: number
  p95ResponseMs: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCost: number
}
