import type { EvalCase, EvalMetrics, EvalResult } from './types'

const ratio = (value: number, total: number) => (total === 0 ? 0 : value / total)

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1)
  return sorted[Math.max(index, 0)]
}

function sameStringSet(left: string[] = [], right: string[] = []) {
  return left.length === right.length && left.every((value) => right.includes(value))
}

function containsExpectedParams(expected: Record<string, unknown>, actual: Record<string, unknown>) {
  return Object.entries(expected).every(([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value))
}

export function calculateEvalMetrics(cases: EvalCase[], results: EvalResult[]): EvalMetrics {
  const caseById = new Map(cases.map((item) => [item.id, item]))
  const evaluated = results.filter((result) => caseById.has(result.caseId))
  const toolResults = evaluated.filter((result) => (caseById.get(result.caseId)?.expectedTools?.length ?? 0) > 0)
  const parameterResults = toolResults.filter((result) => caseById.get(result.caseId)?.expectedParams)
  const ragResults = evaluated.filter((result) => (caseById.get(result.caseId)?.relevantDocumentIds?.length ?? 0) > 0)

  let reciprocalRankTotal = 0
  let ndcgTotal = 0
  let retrievedRelevantTotal = 0
  let relevantTotal = 0

  for (const result of ragResults) {
    const relevant = new Set(caseById.get(result.caseId)?.relevantDocumentIds ?? [])
    const topFive = result.retrievedDocumentIds.slice(0, 5)
    relevantTotal += relevant.size
    retrievedRelevantTotal += topFive.filter((id) => relevant.has(id)).length
    const firstRelevant = topFive.findIndex((id) => relevant.has(id))
    reciprocalRankTotal += firstRelevant < 0 ? 0 : 1 / (firstRelevant + 1)
    const dcg = topFive.reduce((sum, id, index) => sum + (relevant.has(id) ? 1 / Math.log2(index + 2) : 0), 0)
    const idealCount = Math.min(5, relevant.size)
    const idealDcg = Array.from({ length: idealCount }, (_, index) => 1 / Math.log2(index + 2))
      .reduce((sum, score) => sum + score, 0)
    ndcgTotal += idealDcg === 0 ? 0 : dcg / idealDcg
  }

  const citedRelevant = ragResults.reduce((sum, result) => {
    const relevant = new Set(caseById.get(result.caseId)?.relevantDocumentIds ?? [])
    return sum + result.citedDocumentIds.filter((id) => relevant.has(id)).length
  }, 0)
  const citations = ragResults.reduce((sum, result) => sum + result.citedDocumentIds.length, 0)
  const supportedClaims = evaluated.reduce((sum, result) => sum + result.supportedClaims, 0)
  const totalClaims = evaluated.reduce((sum, result) => sum + result.totalClaims, 0)

  return {
    totalCases: evaluated.length,
    taskCompletionRate: ratio(evaluated.filter((result) => result.passed).length, evaluated.length),
    toolSelectionAccuracy: ratio(toolResults.filter((result) => sameStringSet(
      caseById.get(result.caseId)?.expectedTools,
      result.selectedTools,
    )).length, toolResults.length),
    toolParameterAccuracy: ratio(parameterResults.filter((result) => containsExpectedParams(
      caseById.get(result.caseId)?.expectedParams ?? {},
      result.toolParams ?? {},
    )).length, parameterResults.length),
    recallAt5: ratio(retrievedRelevantTotal, relevantTotal),
    mrr: ratio(reciprocalRankTotal, ragResults.length),
    ndcgAt5: ratio(ndcgTotal, ragResults.length),
    citationAccuracy: ratio(citedRelevant, citations),
    hallucinationRate: totalClaims === 0 ? 0 : 1 - ratio(supportedClaims, totalClaims),
    averageTurns: ratio(evaluated.reduce((sum, result) => sum + result.turns, 0), evaluated.length),
    averageFirstTokenMs: ratio(evaluated.reduce((sum, result) => sum + result.firstTokenMs, 0), evaluated.length),
    p50ResponseMs: percentile(evaluated.map((result) => result.durationMs), 0.5),
    p95ResponseMs: percentile(evaluated.map((result) => result.durationMs), 0.95),
    totalInputTokens: evaluated.reduce((sum, result) => sum + result.inputTokens, 0),
    totalOutputTokens: evaluated.reduce((sum, result) => sum + result.outputTokens, 0),
    totalCost: evaluated.reduce((sum, result) => sum + result.cost, 0),
  }
}
