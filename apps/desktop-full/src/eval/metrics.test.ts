import { describe, expect, it } from 'vitest'
import { agentEvalDataset, evalCategoryCounts } from './dataset'
import { calculateEvalMetrics } from './metrics'
import type { EvalCase, EvalResult } from './types'

describe('Agent Eval dataset', () => {
  it('contains the required 70 scenarios', () => {
    expect(agentEvalDataset).toHaveLength(70)
    expect(evalCategoryCounts).toEqual({ file: 20, tool: 15, rag: 15, permission: 10, plan: 10 })
    expect(new Set(agentEvalDataset.map((item) => item.id)).size).toBe(70)
  })
})

describe('calculateEvalMetrics', () => {
  it('calculates task, tool, retrieval, citation and latency metrics', () => {
    const cases: EvalCase[] = [{
      id: 'rag-01', category: 'rag', prompt: 'query', expectedTools: ['searchKnowledge'],
      expectedParams: { query: 'policy' }, relevantDocumentIds: ['doc-a', 'doc-b'], expectedOutcome: 'answer',
    }]
    const results: EvalResult[] = [{
      caseId: 'rag-01', passed: true, selectedTools: ['searchKnowledge'], toolParams: { query: 'policy' },
      retrievedDocumentIds: ['doc-a', 'noise', 'doc-b'], citedDocumentIds: ['doc-a'], supportedClaims: 2,
      totalClaims: 2, turns: 2, firstTokenMs: 120, durationMs: 800, inputTokens: 100, outputTokens: 50,
      cost: 0.01, output: 'answer',
    }]
    const metrics = calculateEvalMetrics(cases, results)
    expect(metrics.taskCompletionRate).toBe(1)
    expect(metrics.toolSelectionAccuracy).toBe(1)
    expect(metrics.toolParameterAccuracy).toBe(1)
    expect(metrics.recallAt5).toBe(1)
    expect(metrics.mrr).toBe(1)
    expect(metrics.citationAccuracy).toBe(1)
    expect(metrics.hallucinationRate).toBe(0)
    expect(metrics.p50ResponseMs).toBe(800)
    expect(metrics.totalInputTokens).toBe(100)
  })

  it('does not produce NaN for an empty run', () => {
    expect(calculateEvalMetrics([], [])).toMatchObject({
      totalCases: 0,
      taskCompletionRate: 0,
      recallAt5: 0,
      totalCost: 0,
    })
  })
})
