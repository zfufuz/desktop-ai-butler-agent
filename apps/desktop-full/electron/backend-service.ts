import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'

export type BackendServiceState = 'starting' | 'ready' | 'degraded' | 'stopped'

export type BackendModelProvider = {
  type: 'zhipu' | 'openai-compatible'
  model: string
  apiKey: string
  baseUrl?: string
}

export type BackendTokenUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export type BackendChatReply = {
  content: string
  usage?: BackendTokenUsage
  runtime: 'python-langchain'
}

export type BackendEmbeddingConfig = {
  model: string
  apiKey: string
  baseUrl: string
}

export type BackendRerankerConfig = {
  model: string
  apiKey: string
  baseUrl: string
}

export type BackendKnowledgeSearchResult = {
  documentId: string
  documentName: string
  chunkIndex: number
  content: string
  score: number
  lexicalScore: number
  semanticScore: number
  retrievalMode: 'keyword' | 'hybrid'
}

export type BackendRagSearchResponse = {
  results: BackendKnowledgeSearchResult[]
  runtime: 'python'
  degradedReasons: string[]
}

export type BackendHttpTool = {
  id: string
  name: string
  description: string
  endpoint: string
  method: 'GET' | 'POST'
  apiKey?: string
  apiKeyPlacement?: 'none' | 'bearer' | 'query' | 'header'
  apiKeyName?: string
  headers?: Record<string, string>
  timeoutMs?: number
  retries?: number
  inputSchema?: {
    properties: Record<string, { type: 'string' | 'number' | 'boolean'; description?: string }>
    required?: string[]
  }
  queryParams?: Record<string, string>
  bodyParams?: Record<string, string>
  responsePath?: string
}

export type BackendToolInvokeResult = {
  name: string
  content: string
  runtime: 'python-langchain'
  durationMs: number
}

export type BackendServiceStatus = {
  state: BackendServiceState
  detail: string
  port?: number
  pid?: number
  version?: string
  framework?: string
  agentFramework?: string
  orchestration?: string
}

export type BackendDiagnosticResult = {
  run_id: string
  intent: string
  response: string
  steps: string[]
}

type BackendServiceOptions = {
  appRoot: string
  resourcesPath: string
  isPackaged: boolean
  startupTimeoutMs?: number
  databasePath?: () => string
  onLog?: (level: 'info' | 'warn' | 'error', message: string) => void
}

type HealthPayload = {
  version: string
  state: 'ready' | 'degraded'
  framework: string
  agent_framework: string
  orchestration: string
}

export class BackendService {
  private readonly options: BackendServiceOptions
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null
  private token = ''
  private stopping = false
  private status: BackendServiceStatus = {
    state: 'stopped',
    detail: 'Backend has not started',
  }

  constructor(options: BackendServiceOptions) {
    this.options = options
  }

  getStatus(): BackendServiceStatus {
    return { ...this.status }
  }

  async start(): Promise<BackendServiceStatus> {
    if (this.status.state === 'ready' || this.status.state === 'starting') {
      return this.getStatus()
    }

    const port = await findAvailablePort()
    this.status = {
      state: 'starting',
      detail: 'Starting FastAPI sidecar',
      port,
    }

    const runtime = this.resolveRuntime()
    if (!runtime) {
      this.status = {
        state: 'degraded',
        detail: 'Python backend runtime is unavailable. Run scripts/setup-backend.ps1.',
      }
      this.log('warn', this.status.detail)
      return this.getStatus()
    }

    this.stopping = false
    this.token = randomBytes(32).toString('hex')

    const environment = {
      ...process.env,
      BUTLER_BACKEND_HOST: '127.0.0.1',
      BUTLER_BACKEND_PORT: String(port),
      BUTLER_BACKEND_TOKEN: this.token,
      BUTLER_DATABASE_PATH: this.options.databasePath?.() ?? '',
      PYTHONUNBUFFERED: '1',
    }

    try {
      const child = spawn(runtime.executable, runtime.args, {
        cwd: runtime.cwd,
        env: environment,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      this.child = child

      this.status.pid = child.pid
      child.stdout.on('data', (chunk: Buffer) => {
        const message = chunk.toString('utf8').trim()
        if (message) this.log('info', message)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        const message = chunk.toString('utf8').trim()
        if (message) this.log('warn', message)
      })
      child.once('error', (error) => {
        if (!this.stopping) this.setDegraded(`Backend process error: ${error.message}`)
      })
      child.once('exit', (code, signal) => {
        this.child = null
        if (!this.stopping) {
          this.setDegraded(`Backend exited unexpectedly (${signal ?? code ?? 'unknown'})`)
        }
      })
    } catch (error) {
      return this.setDegraded(`Failed to launch backend: ${toErrorMessage(error)}`)
    }

    const timeoutMs = this.options.startupTimeoutMs ?? 15_000
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (!this.child) {
        return this.getStatus()
      }

      const health = await this.fetchHealth(port)
      if (health) {
        this.status = {
          state: health.state,
          detail: health.state === 'ready' ? 'FastAPI sidecar is ready' : 'Backend reported degraded state',
          port,
          pid: this.child.pid,
          version: health.version,
          framework: health.framework,
          agentFramework: health.agent_framework,
          orchestration: health.orchestration,
        }
        this.log('info', `${health.framework} / ${health.orchestration} is ready on 127.0.0.1:${port}`)
        return this.getStatus()
      }
      await delay(250)
    }

    this.stop()
    return this.setDegraded(`Backend startup timed out after ${timeoutMs} ms`)
  }

  async restart(): Promise<BackendServiceStatus> {
    this.stop()
    return this.start()
  }

  async invokeDiagnostic(message: string): Promise<BackendDiagnosticResult> {
    if (this.status.state !== 'ready' || !this.status.port) {
      throw new Error(this.status.detail)
    }

    const response = await fetch(`http://127.0.0.1:${this.status.port}/v1/agent/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Butler-Token': this.token,
      },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(20_000),
    })

    if (!response.ok) {
      throw new Error(`Backend request failed with HTTP ${response.status}`)
    }
    return await response.json() as BackendDiagnosticResult
  }

  async invokeChat(
    provider: BackendModelProvider,
    message: string,
  ): Promise<BackendChatReply> {
    const response = await this.post('/v1/model/invoke', {
      message,
      provider,
    }, 70_000)
    if (!response.ok) {
      throw new Error(`Python model request failed with HTTP ${response.status}`)
    }
    return await response.json() as BackendChatReply
  }

  async streamChat(
    provider: BackendModelProvider,
    message: string,
    onDelta: (delta: string) => void,
  ): Promise<BackendChatReply> {
    const response = await this.post('/v1/model/stream', {
      message,
      provider,
    }, 70_000)
    if (!response.ok) {
      throw new Error(`Python model stream failed with HTTP ${response.status}`)
    }
    if (!response.body) {
      throw new Error('Python model stream did not return a readable body')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let usage: BackendTokenUsage | undefined
    let streamError = ''

    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const payloadText = line.slice(5).trim()
        if (!payloadText) continue
        try {
          const payload = JSON.parse(payloadText) as {
            event?: string
            detail?: string
            data?: { usage?: BackendTokenUsage }
          }
          if (payload.event === 'model.delta' && payload.detail) {
            content += payload.detail
            onDelta(payload.detail)
          } else if (payload.event === 'model.completed') {
            usage = payload.data?.usage
            if (!content && payload.detail) content = payload.detail
          } else if (payload.event === 'model.failed') {
            streamError = payload.detail || 'Python model stream failed'
          }
        } catch {
          // Ignore SSE keep-alive or malformed non-data lines.
        }
      }

      if (done) break
    }

    if (streamError) throw new Error(streamError)
    return {
      content: content || '模型没有返回内容。',
      usage,
      runtime: 'python-langchain',
    }
  }

  async searchKnowledge(
    query: string,
    limit: number,
    embedding?: BackendEmbeddingConfig,
    reranker?: BackendRerankerConfig,
  ): Promise<BackendRagSearchResponse> {
    const response = await this.post('/v1/rag/search', {
      query,
      limit,
      embedding,
      reranker,
    }, 70_000)
    if (!response.ok) {
      throw new Error(`Python RAG search failed with HTTP ${response.status}`)
    }
    return await response.json() as BackendRagSearchResponse
  }

  async invokeTool(
    tool: BackendHttpTool,
    input: string,
  ): Promise<BackendToolInvokeResult> {
    const response = await this.post('/v1/tools/invoke', {
      tool,
      input,
    }, Math.max(10_000, Math.min((tool.timeoutMs ?? 20_000) * ((tool.retries ?? 0) + 1) + 5_000, 200_000)))
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`Python Tool request failed with HTTP ${response.status}: ${detail.slice(0, 300)}`)
    }
    return await response.json() as BackendToolInvokeResult
  }

  private async post(pathname: string, body: unknown, timeoutMs: number): Promise<Response> {
    if (this.status.state !== 'ready' || !this.status.port) {
      throw new Error(this.status.detail)
    }
    return await fetch(`http://127.0.0.1:${this.status.port}${pathname}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Butler-Token': this.token,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  }

  stop(): void {
    this.stopping = true
    const child = this.child
    this.child = null
    if (child && !child.killed) {
      child.kill()
    }
    this.status = {
      state: 'stopped',
      detail: 'Backend stopped',
    }
  }

  private resolveRuntime(): { executable: string; args: string[]; cwd: string } | null {
    if (this.options.isPackaged) {
      const backendDirectory = path.join(this.options.resourcesPath, 'backend')
      const executable = path.join(backendDirectory, 'agent-backend.exe')
      return existsSync(executable)
        ? { executable, args: [], cwd: backendDirectory }
        : null
    }

    const backendDirectory = path.join(this.options.appRoot, 'backend')
    const configuredPython = process.env.BUTLER_PYTHON_PATH?.trim()
    const virtualEnvironmentPython = path.join(backendDirectory, '.venv', 'Scripts', 'python.exe')
    const executable = configuredPython || virtualEnvironmentPython
    if (!existsSync(executable)) {
      return null
    }
    return {
      executable,
      args: ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(this.status.port ?? 0)],
      cwd: backendDirectory,
    }
  }

  private async fetchHealth(port: number): Promise<HealthPayload | null> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(750),
      })
      if (!response.ok) return null
      return await response.json() as HealthPayload
    } catch {
      return null
    }
  }

  private setDegraded(detail: string): BackendServiceStatus {
    this.status = {
      state: 'degraded',
      detail,
    }
    this.log('error', detail)
    return this.getStatus()
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.options.onLog?.(level, message)
  }
}

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Unable to reserve a local backend port'))
        return
      }
      const port = address.port
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
