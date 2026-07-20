import type React from 'react'
import { LoaderCircle, Paperclip, Send, X } from 'lucide-react'

type ChatInputProps = {
  input: string
  inputRef: React.RefObject<HTMLInputElement | null>
  isThinking: boolean
  attachments: { id: number; name: string }[]
  onInputChange: (value: string) => void
  onSend: () => void
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
  onAddFiles,
  onRemoveAttachment,
}: ChatInputProps) {
  const canSend = Boolean(input.trim()) || attachments.length > 0

  return (
    <footer className="input-bar">
      {attachments.length > 0 && (
        <div className="attachment-strip">
          {attachments.map((attachment) => (
            <button
              key={attachment.id}
              className="attachment-chip"
              onClick={() => onRemoveAttachment(attachment.id)}
              disabled={isThinking}
              title="点击移除文件"
            >
              <span>{attachment.name}</span>
              <X aria-hidden="true" size={14} />
            </button>
          ))}
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
        <input
          ref={inputRef}
          value={input}
          placeholder="描述你想让管家怎么处理这些文件，或直接输入问题..."
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSend()
          }}
          disabled={isThinking}
        />
      </div>
      <button className="send-button" onClick={onSend} disabled={!canSend || isThinking}>
        {isThinking ? <LoaderCircle className="spin" aria-hidden="true" size={17} /> : <Send aria-hidden="true" size={17} />}
        <span>{isThinking ? '处理中' : '发送'}</span>
      </button>
    </footer>
  )
}

export default ChatInput
