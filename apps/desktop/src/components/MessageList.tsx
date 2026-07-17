import type React from 'react'
import type { Message } from '../type'

type MessageListProps = {
  messages: Message[]
  messageEndRef: React.RefObject<HTMLDivElement | null>
}

function formatMessageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function MessageList({ messages, messageEndRef }: MessageListProps) {
  return (
    <div className="message-list">
      {messages.map((message) => (
        <div key={message.id} className={`message ${message.role}`}>
          <div className="message-content">{message.content}</div>
              <div className="message-time">
                {formatMessageTime(message.createdAt)}
        </div>
            </div>
          ))}
      <div ref={messageEndRef} />
    </div>
  )
}

export default MessageList