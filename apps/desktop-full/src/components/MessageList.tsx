// 消息列表：渲染 Markdown 对话，并在用户停留底部时跟随流式输出滚动。
import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message } from '../type'

type MessageListProps = {
  messages: Message[]
}

function formatMessageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function MessageList({ messages }: MessageListProps) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const shouldFollowOutputRef = useRef(true)

  useEffect(() => {
    const list = listRef.current
    if (!list || !shouldFollowOutputRef.current) return
    list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
  }, [messages])

  return (
    <div
      ref={listRef}
      className="message-list"
      onScroll={(event) => {
        const list = event.currentTarget
        const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight
        shouldFollowOutputRef.current = distanceFromBottom < 80
      }}
    >
      {messages.map((message) => (
        <div key={message.id} className={`message ${message.role}`}>
          <div className="message-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
          <div className="message-time">{formatMessageTime(message.createdAt)}</div>
        </div>
      ))}
    </div>
  )
}

export default MessageList
