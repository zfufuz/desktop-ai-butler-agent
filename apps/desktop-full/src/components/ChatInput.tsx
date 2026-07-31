// 聊天输入区：管理多行文本、待发送附件、发送和停止状态。
import { useEffect } from 'react'
import type React from 'react'
import { FileText, Paperclip, Send, Square, X } from 'lucide-react'

type ChatInputProps = {
  input: string
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  isThinking: boolean
  attachments: { id: number; name: string }[]
  onInputChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  onAddFiles: () => void
  onRemoveAttachment: (id: number) => void
}

function ChatInput({
  input,
  inputRef,
  isThinking,
  attachments,
  onInputChange,
  onSend,
  onStop,
  onAddFiles,
  onRemoveAttachment,
}: ChatInputProps) {
  const canSend = Boolean(input.trim()) || attachments.length > 0

  useEffect(() => {
    const textarea = inputRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 156)}px`
  }, [input, inputRef])

  return (
    <footer className="input-bar">
      {attachments.length > 0 && (
        <div className="attachment-preview">
          <span className="attachment-preview-label">{attachments.length} 个待发送文件</span>
          <div className="attachment-strip">
            {attachments.map((attachment) => (
              <button
                key={attachment.id}
                className="attachment-chip"
                onClick={() => onRemoveAttachment(attachment.id)}
                disabled={isThinking}
                title="移除文件"
              >
                <FileText aria-hidden="true" size={15} />
                <span>{attachment.name}</span>
                <X aria-hidden="true" size={14} />
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="composer-row">
        <button
          className="add-file-button"
          onClick={onAddFiles}
          disabled={isThinking}
          title="添加文件，最多 10 个"
          aria-label="添加文件，最多 10 个"
        >
          <Paperclip aria-hidden="true" size={18} />
        </button>
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder="描述你想让管家怎么处理这些文件，或直接输入问题..."
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              onSend()
            }
          }}
          disabled={isThinking}
        />
      </div>
      {isThinking ? (
        <button className="send-button stop" onClick={onStop} title="停止当前任务">
          <Square aria-hidden="true" size={15} />
          <span>停止</span>
        </button>
      ) : (
        <button className="send-button" onClick={onSend} disabled={!canSend}>
          <Send aria-hidden="true" size={17} />
          <span>发送</span>
        </button>
      )}
    </footer>
  )
}

export default ChatInput
