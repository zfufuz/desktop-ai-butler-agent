import type React from 'react'

type ChatInputProps = {
  input: string
  inputRef: React.RefObject<HTMLInputElement | null>
  isThinking: boolean
  onInputChange: (value: string) => void
  onSend: () => void
}

function ChatInput({ input, inputRef, isThinking, onInputChange, onSend }: ChatInputProps) {
  return (
    <footer className="input-bar">
        <input
        ref={inputRef}
        value={input}
        placeholder = "输入你想让我做的事情..."
        onChange={(event) => onInputChange(event.target.value)}
        onKeyDown={(event) => {
            if (event.key === 'Enter') {
                onSend()
            }
        }}
        disabled={isThinking}
      />
      <button onClick={onSend} disabled={!input.trim() || isThinking}>
        发送
      </button>
    </footer>
  )
}

export default ChatInput