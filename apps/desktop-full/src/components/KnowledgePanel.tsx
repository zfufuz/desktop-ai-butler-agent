export type KnowledgeDocumentSummary = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  chunkCount: number
  characterCount: number
  embeddingCount: number
}

export type KnowledgeSearchResult = {
  documentId: string
  documentName: string
  chunkIndex: number
  content: string
  score: number
  lexicalScore: number
  semanticScore: number
  retrievalMode: 'keyword' | 'hybrid'
}

type KnowledgePanelProps = {
  documents: KnowledgeDocumentSummary[]
  results: KnowledgeSearchResult[]
  query: string
  disabled: boolean
  onQueryChange: (query: string) => void
  onSearch: () => void
  onImport: () => void
  onRemove: (document: KnowledgeDocumentSummary) => void
}

function KnowledgePanel({
  documents,
  results,
  query,
  disabled,
  onQueryChange,
  onSearch,
  onImport,
  onRemove,
}: KnowledgePanelProps) {
  return (
    <div className="insight-section">
      <h3>本地资料库</h3>
      <p>资料只保存在本机。检索结果会带来源片段交给 Agent，删除索引不会删除原始文件。</p>
      <button className="panel-action-button" onClick={onImport} disabled={disabled}>
        导入资料
      </button>
      <div className="knowledge-search">
        <input
          value={query}
          placeholder="测试资料库检索，例如：上季度退款原因"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && onSearch()}
        />
        <button onClick={onSearch} disabled={!query.trim()}>检索</button>
      </div>
      {results.length > 0 && (
        <div className="knowledge-results">
          <strong>命中片段</strong>
          {results.map((result) => (
            <details key={`${result.documentId}-${result.chunkIndex}`}>
              <summary>
                {result.documentName} · 片段 {result.chunkIndex + 1} · {result.retrievalMode === 'hybrid' ? '混合检索' : 'BM25'}
              </summary>
              <p>{result.content}</p>
              <small>综合 {result.score.toFixed(3)} · 关键词 {result.lexicalScore.toFixed(3)} · 语义 {result.semanticScore.toFixed(3)}</small>
            </details>
          ))}
        </div>
      )}
      <div className="knowledge-list">
        {documents.length === 0 ? <p>资料库为空，先导入一份文档。</p> : documents.map((document) => (
          <div className="knowledge-item" key={document.id}>
            <span>
              <strong>{document.name}</strong>
              <small>
                {document.chunkCount} 个片段 · {document.embeddingCount ?? 0} 个向量 · {document.characterCount.toLocaleString('zh-CN')} 字符
              </small>
            </span>
            <button onClick={() => onRemove(document)}>删除</button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default KnowledgePanel
