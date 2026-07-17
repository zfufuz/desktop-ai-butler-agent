import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'

type AppErrorBoundaryProps = {
  children: ReactNode
}

type AppErrorBoundaryState = {
  error: Error | null
}

class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Desktop AI Butler render error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main className="fatal-error">
        <TriangleAlert aria-hidden="true" size={32} />
        <h1>界面暂时无法显示</h1>
        <p>你的本地资料和计划仍然保存在电脑上。重新加载通常可以恢复。</p>
        <button onClick={() => window.location.reload()}>
          <RefreshCw aria-hidden="true" size={16} />
          重新加载
        </button>
        <details>
          <summary>错误详情</summary>
          <code>{this.state.error.message}</code>
        </details>
      </main>
    )
  }
}

export default AppErrorBoundary
