// 消息列表：渲染 Markdown，对流式输出保持“用户在底部才自动跟随”的阅读体验。
import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  CalendarPlus,
  Check,
  CircleCheck,
  CircleX,
  Copy,
  LoaderCircle,
  RotateCcw,
  Save,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { parseStructuredAnswer } from '../lib/structuredAnswer'
import type { AgentTimelineStep } from '../services/agent'
import type { Message } from '../type'

type MessageListProps = {
  messages: Message[]
  timeline?: AgentTimelineStep[]
  isExecuting?: boolean
  onSaveResult?: (content: string, createPlans: boolean) => void
  onRegenerate?: () => void
}

function formatMessageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function MessageList({
  messages,
  timeline = [],
  isExecuting = false,
  onSaveResult,
  onRegenerate,
}: MessageListProps) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const shouldFollowOutputRef = useRef(true)
  const [showLatestButton, setShowLatestButton] = useState(false)
  const [copiedMessageId, setCopiedMessageId] = useState<number | null>(null)

  const scrollToLatest = (behavior: ScrollBehavior = 'smooth') => {
    const list = listRef.current
    if (!list) return
    shouldFollowOutputRef.current = true
    setShowLatestButton(false)
    list.scrollTo({ top: list.scrollHeight, behavior })
  }

  useEffect(() => {
    if (shouldFollowOutputRef.current) {
      scrollToLatest(messages.length <= 1 ? 'auto' : 'smooth')
    } else {
      setShowLatestButton(true)
    }
  }, [messages])

  const copyMessage = async (message: Message) => {
    await navigator.clipboard.writeText(message.content)
    setCopiedMessageId(message.id)
    window.setTimeout(() => setCopiedMessageId(null), 1500)
  }

  const latestAssistantId = [...messages].reverse().find((message) => message.role === 'assistant')?.id
  const executionCard = timeline.length > 0 ? (
    <ExecutionCard timeline={timeline} isExecuting={isExecuting} />
  ) : null

  return (
    <div className="message-list-shell">
      <div
        ref={listRef}
        className="message-list"
        onScroll={(event) => {
          const list = event.currentTarget
          const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight
          const shouldFollow = distanceFromBottom < 80
          shouldFollowOutputRef.current = shouldFollow
          setShowLatestButton(!shouldFollow)
        }}
      >
        {messages.map((message) => (
          <div className={`message-row ${message.role}`} key={message.id}>
          {message.id === latestAssistantId && executionCard}
          <article className={`message ${message.role}`}>
            <header className="message-meta">
              <span>{message.role === 'assistant' ? '管家' : '你'}</span>
              <time dateTime={new Date(message.createdAt).toISOString()}>
                {formatMessageTime(message.createdAt)}
              </time>
            </header>
            <div className="message-content">
              {message.role === 'assistant' ? (
                <AssistantMessageContent
                  content={message.content}
                  onSaveResult={onSaveResult}
                />
              ) : (
                <MarkdownContent content={message.content} />
              )}
            </div>
            <button
              className="message-copy-button"
              title="复制消息"
              aria-label="复制消息"
              onClick={() => void copyMessage(message)}
            >
              {copiedMessageId === message.id ? <Check size={14} /> : <Copy size={14} />}
            </button>
            {message.id === latestAssistantId && onRegenerate && !isExecuting && (
              <div className="message-footer-actions">
                <button onClick={() => void copyMessage(message)}>
                  {copiedMessageId === message.id ? <Check size={14} /> : <Copy size={14} />}
                  {copiedMessageId === message.id ? '已复制' : '复制'}
                </button>
                <button onClick={onRegenerate}>
                  <RotateCcw size={14} />
                  重新生成
                </button>
              </div>
            )}
          </article>
          </div>
        ))}
        {!latestAssistantId && executionCard}
      </div>
      {showLatestButton && (
        <button className="scroll-latest-button" onClick={() => scrollToLatest()} title="回到最新消息">
          <ArrowDown size={16} />
          <span>最新消息</span>
        </button>
      )}
    </div>
  )
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children, ...props }) => (
          <a {...props} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

function AssistantMessageContent({
  content,
  onSaveResult,
}: {
  content: string
  onSaveResult?: (content: string, createPlans: boolean) => void
}) {
  const sections = parseStructuredAnswer(content)
  if (!sections) return <MarkdownContent content={content} />

  return (
    <div className="structured-answer">
      {sections.map((section, index) => (
        <section className={`answer-section ${section.kind}`} key={`${section.kind}-${index}`}>
          <h3>{section.title}</h3>
          <MarkdownContent content={section.content} />
        </section>
      ))}
      {onSaveResult && (
        <div className="answer-actions">
          <button onClick={() => onSaveResult(content, false)}>
            <Save size={15} />保存为报告
          </button>
          <button className="primary" onClick={() => onSaveResult(content, true)}>
            <CalendarPlus size={15} />保存并建计划
          </button>
        </div>
      )}
    </div>
  )
}

function ExecutionCard({
  timeline,
  isExecuting,
}: {
  timeline: AgentTimelineStep[]
  isExecuting: boolean
}) {
  const orderedSteps = [...timeline].reverse()
  const failedCount = orderedSteps.filter((step) => step.status === 'error').length
  const toolCallCount = orderedSteps.filter((step) => step.title === '调用工具').length
  const elapsedMs = Math.max(
    0,
    (isExecuting ? Date.now() : orderedSteps.at(-1)?.createdAt ?? Date.now()) -
      (orderedSteps[0]?.createdAt ?? Date.now()),
  )
  const phaseDefinitions = [
    { label: '理解目标', matches: ['接收目标'] },
    { label: '制定计划', matches: ['规划任务', '选择下一步'] },
    { label: '调用工具', matches: ['调用工具', '观察结果'] },
    { label: '整理结果', matches: ['整理结果'] },
  ]
  const phases = phaseDefinitions.map((phase) => {
    const matchedSteps = orderedSteps.filter((step) => phase.matches.includes(step.title))
    const hasError = matchedSteps.some((step) => step.status === 'error')
    const done = matchedSteps.length > 0
    const active = isExecuting && !done && phase.label === (
      toolCallCount > 0 ? '整理结果' : orderedSteps.some((step) => step.title === '选择下一步') ? '调用工具' : '制定计划'
    )
    return { ...phase, status: hasError ? 'error' : done ? 'success' : active ? 'running' : 'pending' }
  })

  return (
    <details className={`execution-card ${failedCount > 0 ? 'has-error' : ''}`}>
      <summary>
        <span className="execution-status-icon">
          {isExecuting ? <LoaderCircle className="spin" size={16} /> : failedCount > 0 ? <CircleX size={16} /> : <CircleCheck size={16} />}
        </span>
        <span>
          <strong>{isExecuting ? 'Agent 正在执行' : failedCount > 0 ? '执行完成，存在失败步骤' : 'Agent 执行完成'}</strong>
          <small>
            {toolCallCount} 次工具调用 · {(elapsedMs / 1000).toFixed(1)} 秒
            {failedCount > 0 ? ` · ${failedCount} 个失败` : ''}
          </small>
        </span>
        <span className="execution-expand">
          <span className="collapsed-label">查看过程</span>
          <span className="expanded-label">收起过程</span>
        </span>
      </summary>
      <div className="execution-step-list">
        <div className="execution-phase-grid" aria-label="Agent 执行阶段">
          {phases.map((phase, index) => (
            <div className={`execution-phase ${phase.status}`} key={phase.label}>
              <span>{index + 1}</span>
              <strong>{phase.label}</strong>
              <small>
                {phase.status === 'success' ? '完成' : phase.status === 'error' ? '失败' : phase.status === 'running' ? '进行中' : '等待'}
              </small>
            </div>
          ))}
        </div>
        {orderedSteps.map((step, index) => (
          <div className={`execution-step ${step.status}`} key={step.id}>
            <span className="execution-step-index">{index + 1}</span>
            <div>
              <strong>{step.title}</strong>
              <small>{step.detail}</small>
            </div>
          </div>
        ))}
      </div>
    </details>
  )
}

export default MessageList
