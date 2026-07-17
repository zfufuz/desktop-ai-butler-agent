import { useState,useEffect, useRef } from 'react'
import './App.css'
import AvatarPanel from './components/AvatarPanel'
import MessageList from './components/MessageList'
import ChatInput from './components/ChatInput'
import type { AssistantStatus, Message } from './type'
import { createAssistantReply } from './services/assistant'
function createMessageId() {
  return Date.now() + Math.random()
}

function getAssistantStatusText(status: AssistantStatus) {
  if (status === 'thinking') {
    return '思考中'
  }

  return '待机中'
}

function App() {
  const [input, setInput] = useState('')
  const [assistantStatus, setAssistantStatus] = useState<AssistantStatus>('idle')
  const [appName] = useState(() => window.electronAPI?.getAppName() ?? '桌面 AI 管家')
  const [appVersion, setAppVersion] = useState('')
  const [systemInfoText, setSystemInfoText] = useState('')
  const isThinking = assistantStatus === 'thinking'
  const messageEndRef  = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      role: 'assistant',
      content: '你好，我是你的桌面 AI 管家。第一版我会先学会聊天、说话、看文件、改代码和提醒你休息。',
      createdAt: Date.now(),
    },
    {
      id: 2,
      role: 'user',
      content: '今天先把项目骨架搭起来。',
      createdAt: Date.now(),
    },
  ])
  useEffect(() => {
  window.electronAPI?.getSystemInfo().then((systemInfo) => {
    setSystemInfoText(`${systemInfo.platform} / ${systemInfo.arch} / ${systemInfo.cpus} 核`)
  })
}, [])
  useEffect(() => {
  window.electronAPI?.getAppVersion().then(setAppVersion)
  }, [])
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])
  useEffect(() => {
  if (!isThinking) {
    inputRef.current?.focus()
  }
}, [isThinking])
  

  async function sendMessage() {
    if (isThinking) {
      return
    }
    const text = input.trim()
    if (!text){
      return
    }

    const userMessage: Message = {
      id: createMessageId(),
      role: 'user',
      content: text,
      createdAt: Date.now(),
    }

    

    setMessages((currentMessages) => [
      ...currentMessages,
       userMessage
       ])

    setInput('')
    setAssistantStatus('thinking')
    
      try {
          const assistantReply = await createAssistantReply(text)
          const assistantMessage: Message = {
            id: createMessageId(),
            role: 'assistant',
            content: assistantReply.content,
            createdAt: Date.now(),
          }
           setMessages((currentMessages) => [...currentMessages, assistantMessage])
        } catch  {
                   const errorMessage: Message = {
                    id: createMessageId(),
                    role: 'assistant',
                    content: '抱歉，我刚才处理失败了。你可以再试一次。',
                    createdAt: Date.now(),
                   }
          setMessages((currentMessages) => [...currentMessages, errorMessage])
        } finally {
          
          setAssistantStatus('idle')
        }    
    

  }
  return (
    <main className="app-shell">
      <AvatarPanel
            appName={appName}
            appVersion={appVersion}
            systemInfoText={systemInfoText}
            statusText={getAssistantStatusText(assistantStatus)}
          />       
      <section className="chat-panel">
        <header className="chat-header">
          <div>
            <h1>桌面 AI 管家</h1>
            <p>Live2D / 聊天 / 语音 / 文件助手</p>
          </div>
          <button className="settings-button">设置</button>
        </header>

        <MessageList messages={messages} messageEndRef={messageEndRef} />

        <ChatInput
          input={input}
          inputRef={inputRef}
          isThinking={isThinking}
          onInputChange={setInput}
          onSend={sendMessage}
/>
      </section>
    </main>
  )
}

export default App
