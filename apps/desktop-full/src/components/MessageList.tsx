// 消息列表：渲染 Markdown，对流式输出保持“用户在底部才自动跟随”的阅读体验。
import { useEffect, useRef, useState } from 'react'
import { ArrowDown, Check, Copy } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message } from '../type'

type MessageListProps = {
  messages: Message[]
}

function formatMessageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function MessageList({ messages }: MessageListProps) {
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
          <article key={message.id} className={`message ${message.role}`}>
            <header className="message-meta">
              <span>{message.role === 'assistant' ? '管家' : '你'}</span>
              <time dateTime={new Date(message.createdAt).toISOString()}>
                {formatMessageTime(message.createdAt)}
              </time>
            </header>
            <div className="message-content">
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
                {message.content}
              </ReactMarkdown>
            </div>
            <button
              className="message-copy-button"
              title="复制消息"
              aria-label="复制消息"
              onClick={() => void copyMessage(message)}
            >
              {copiedMessageId === message.id ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </article>
        ))}
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

export default MessageList
