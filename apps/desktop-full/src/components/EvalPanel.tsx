import { useState } from 'react'
import { agentEvalDataset, evalCategoryCounts, ragEvalFixtures } from '../eval/dataset'
import { calculateEvalMetrics } from '../eval/metrics'
import type { EvalResult } from '../eval/types'

type RagMetrics = ReturnType<typeof calculateEvalMetrics>

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

export default function EvalPanel() {
  const [running, setRunning] = useState(false)
  const [metrics, setMetrics] = useState<RagMetrics | null>(null)
  const [error, setError] = useState('')
  const [durationMs, setDurationMs] = useState(0)

  async function runRagBenchmark() {
    if (!window.electronAPI || running) return
    setRunning(true)
    setError('')
    const startedAt = performance.now()
    try {
      await window.electronAPI.syncKnowledgeDocuments(ragEvalFixtures)
      const ragCases = agentEvalDataset.filter((item) => item.category === 'rag')
      const results: EvalResult[] = []
      for (const evalCase of ragCases) {
        const caseStartedAt = performance.now()
        const hits = await window.electronAPI.searchKnowledge(evalCase.prompt, 5)
        const retrievedDocumentIds = hits.map((item) => item.documentId)
        const relevant = new Set(evalCase.relevantDocumentIds ?? [])
        results.push({
          caseId: evalCase.id,
          passed: retrievedDocumentIds.some((id) => relevant.has(id)),
          selectedTools: ['searchKnowledge'],
          toolParams: { query: evalCase.prompt },
          retrievedDocumentIds,
          citedDocumentIds: [],
          supportedClaims: 0,
          totalClaims: 0,
          turns: 1,
          firstTokenMs: 0,
          durationMs: performance.now() - caseStartedAt,
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
          output: hits.map((item) => item.content).join('\n'),
        })
      }
      setMetrics(calculateEvalMetrics(ragCases, results))
      setDurationMs(performance.now() - startedAt)
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError))
    } finally {
      await Promise.allSettled(ragEvalFixtures.map((fixture) =>
        window.electronAPI.deleteKnowledgeDocument(fixture.id),
      ))
      setRunning(false)
    }
  }

  return (
    <div className="insight-section eval-panel">
      <h3>Agent Eval</h3>
      <p>题库共 70 条。当前按钮会临时导入测试语料，真实执行 15 条本地 RAG 检索，完成后自动清理，不会把未执行项目算成成绩。</p>
      <div className="eval-counts">
        <span>文件 {evalCategoryCounts.file}</span><span>Tool {evalCategoryCounts.tool}</span>
        <span>RAG {evalCategoryCounts.rag}</span><span>权限 {evalCategoryCounts.permission}</span>
        <span>计划 {evalCategoryCounts.plan}</span>
      </div>
      <button className="panel-action-button" onClick={() => void runRagBenchmark()} disabled={running}>
        {running ? '正在执行 15 条检索…' : '运行 RAG 基准'}
      </button>
      {error && <p className="run-error">运行失败：{error}</p>}
      {metrics && (
        <div className="eval-metrics-grid">
          <div><small>Recall@5</small><strong>{percent(metrics.recallAt5)}</strong></div>
          <div><small>MRR</small><strong>{metrics.mrr.toFixed(3)}</strong></div>
          <div><small>NDCG@5</small><strong>{metrics.ndcgAt5.toFixed(3)}</strong></div>
          <div><small>命中任务</small><strong>{metrics.totalCases} 条</strong></div>
          <div><small>任务完成率</small><strong>{percent(metrics.taskCompletionRate)}</strong></div>
          <div><small>总耗时</small><strong>{Math.round(durationMs)} ms</strong></div>
        </div>
      )}
      <p className="eval-note">Tool 选择、权限恢复和计划复盘题仍标记为“待执行”，不会显示虚构分数。</p>
    </div>
  )
}
