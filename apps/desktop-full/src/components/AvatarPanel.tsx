// 管家主导航：保留角色状态，同时提供对话、任务、日程、资料和运行记录入口。
import {
  Bot,
  CalendarDays,
  Files,
  HardDrive,
  ListChecks,
  MessageSquare,
  Plus,
  ShieldCheck,
  Trash2,
  Workflow,
} from 'lucide-react'
import type { ConversationSummary } from '../type'

export type AvatarNavigationPage = 'home' | 'plans' | 'schedule' | 'knowledge' | 'runs'

type AvatarPanelProps = {
  appName: string
  appVersion: string
  systemInfoText: string
  statusText: string
  activePage: string
  conversations: ConversationSummary[]
  activeConversationId: string | null
  conversationBusy: boolean
  onNavigate: (page: AvatarNavigationPage) => void
  onNewConversation: () => void
  onOpenConversation: (conversationId: string) => void
  onDeleteConversation: (conversation: ConversationSummary) => void
  onShowAllConversations: () => void
}

const navigationItems: Array<{
  page: AvatarNavigationPage
  label: string
  icon: typeof MessageSquare
}> = [
  { page: 'home', label: '对话', icon: MessageSquare },
  { page: 'plans', label: '今日', icon: ListChecks },
  { page: 'schedule', label: '日程', icon: CalendarDays },
  { page: 'knowledge', label: '资料', icon: Files },
  { page: 'runs', label: '执行', icon: Workflow },
]

function AvatarPanel({
  appName,
  appVersion,
  systemInfoText,
  statusText,
  activePage,
  conversations,
  activeConversationId,
  conversationBusy,
  onNavigate,
  onNewConversation,
  onOpenConversation,
  onDeleteConversation,
  onShowAllConversations,
}: AvatarPanelProps) {
  return (
    <section className="avatar-panel">
      <div className="avatar-placeholder">
        <div className="avatar-brand">
          <div className={`avatar-face ${statusText.includes('思考') || statusText.includes('处理') ? 'is-active' : ''}`}>
            <Bot aria-hidden="true" size={28} />
            <span className="avatar-signal" aria-hidden="true" />
          </div>
          <div><div className="avatar-name">{appName}</div><div className="avatar-version">版本 {appVersion || '开发中'}</div></div>
        </div>
        <div className="avatar-status"><span className="status-dot" />{statusText}</div>

        <nav className="avatar-navigation" aria-label="主导航">
          {navigationItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.page}
                className={activePage === item.page || (item.page === 'home' && activePage === 'data') ? 'active' : ''}
                onClick={() => onNavigate(item.page)}
              >
                <Icon aria-hidden="true" size={17} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <section className="sidebar-conversations" aria-label="对话记录">
          <div className="sidebar-conversations-heading">
            <span>对话</span>
            <button onClick={onNewConversation} disabled={conversationBusy} title="新建对话" aria-label="新建对话">
              <Plus aria-hidden="true" size={15} />
            </button>
          </div>
          <div className="sidebar-conversation-list">
            {conversations.slice(0, 12).map((conversation) => (
              <div className={conversation.id === activeConversationId ? 'active' : ''} key={conversation.id}>
                <button className="sidebar-conversation-open" onClick={() => onOpenConversation(conversation.id)} title={conversation.title}>
                  <MessageSquare aria-hidden="true" size={14} />
                  <span>{conversation.title}</span>
                </button>
                <button
                  className="sidebar-conversation-delete"
                  onClick={() => onDeleteConversation(conversation)}
                  disabled={conversationBusy}
                  title="删除对话"
                  aria-label={`删除对话：${conversation.title}`}
                >
                  <Trash2 aria-hidden="true" size={13} />
                </button>
              </div>
            ))}
          </div>
          {conversations.length > 0 && (
            <button className="sidebar-conversations-more" onClick={onShowAllConversations}>管理全部对话</button>
          )}
        </section>

        <div className="avatar-meta">
          <span><HardDrive aria-hidden="true" size={15} />{systemInfoText || '正在读取系统信息'}</span>
          <span><ShieldCheck aria-hidden="true" size={15} />本地数据受保护</span>
        </div>
        <p className="avatar-note">资料和执行记录默认保存在本机。</p>
      </div>
    </section>
  )
}

export default AvatarPanel
