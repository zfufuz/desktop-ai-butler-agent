import { app, BrowserWindow, Notification, Tray, dialog, globalShortcut, ipcMain, safeStorage, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const DEV_SERVER_URL = 'http://localhost:5173'
const APP_TITLE = '桌面 AI 管家'
const SAFE_STORAGE_PREFIX = 'safe-storage:v1:'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.join(__dirname, '..')

type ProviderType = 'mock' | 'zhipu' | 'openai-compatible'

type ModelProviderConfig = {
  id: string
  name: string
  type: ProviderType
  model: string
  apiKey?: string
  baseUrl?: string
}

type CustomSkillConfig = {
  id: string
  name: string
  description: string
  prompt: string
  enabled?: boolean
  source?: 'manual' | 'extension'
}

type CustomToolConfig = {
  id: string
  name: string
  description: string
  endpoint: string
  method: 'GET' | 'POST'
  apiKey?: string
  enabled?: boolean
  source?: 'manual' | 'extension'
}

type PickedTextFile = {
  name: string
  path: string
  content: string
}

type PlanStatus = 'active' | 'done'

type ButlerReport = {
  id: string
  title: string
  summary: string
  content: string
  source: string
  createdAt: number
}

type ButlerPlan = {
  id: string
  title: string
  description: string
  status: PlanStatus
  checkins: number
  lastCheckinAt?: number
  reminderTime?: string
  lastReminderDate?: string
  createdAt: number
  updatedAt: number
}

type ButlerActivity = {
  id: string
  type: 'report' | 'plan' | 'checkin' | 'note'
  text: string
  createdAt: number
}

type ButlerWorkspaceData = {
  reports: ButlerReport[]
  plans: ButlerPlan[]
  activities: ButlerActivity[]
}

type StoredAgentRun = {
  id: string
  goal: string
  status: 'running' | 'completed' | 'blocked' | 'failed'
  turns: number
  startedAt: number
  finishedAt?: number
  observations: unknown[]
  final?: string
  error?: string
}

type AgentPlatformConfig = {
  activeProviderId: string
  providers: ModelProviderConfig[]
  customSkills: CustomSkillConfig[]
  customTools: CustomToolConfig[]
}

let mainWindow: BrowserWindow | null = null
let floatingReportWindow: BrowserWindow | null = null
let tray: Tray | null = null

function readLocalEnv() {
  const envPath = path.join(appRoot, '.env.local')

  if (!fs.existsSync(envPath)) {
    return {}
  }

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  return Object.fromEntries(
    lines
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separatorIndex = line.indexOf('=')
        return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)]
      }),
  )
}

const localEnv = readLocalEnv()
const plainTextExtensions = new Set([
  '.txt',
  '.md',
  '.json',
  '.log',
  '.csv',
  '.tsv',
  '.html',
  '.htm',
  '.xml',
  '.yaml',
  '.yml',
  '.ini',
  '.env',
  '.sql',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.css',
  '.scss',
  '.less',
  '.py',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.cs',
  '.go',
  '.rs',
  '.php',
  '.rb',
  '.sh',
  '.ps1',
])
const officeExtensions = new Set(['.docx', '.xlsx', '.pptx'])
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
const supportedFileExtensions = new Set([
  ...plainTextExtensions,
  ...officeExtensions,
  ...imageExtensions,
  '.pdf',
])

function stripXmlTags(xml: string) {
  return xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function readZipEntries(filePath: string) {
  const buffer = fs.readFileSync(filePath)
  const entries = new Map<string, Buffer>()
  let offset = 0

  while (offset < buffer.length - 30) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      offset += 1
      continue
    }

    const compressionMethod = buffer.readUInt16LE(offset + 8)
    const compressedSize = buffer.readUInt32LE(offset + 18)
    const fileNameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const fileName = buffer.slice(offset + 30, offset + 30 + fileNameLength).toString('utf8')
    const dataStart = offset + 30 + fileNameLength + extraLength
    const dataEnd = dataStart + compressedSize
    const compressedData = buffer.slice(dataStart, dataEnd)

    try {
      if (compressionMethod === 0) {
        entries.set(fileName, compressedData)
      } else if (compressionMethod === 8) {
        entries.set(fileName, zlib.inflateRawSync(compressedData))
      }
    } catch {
      // Ignore unreadable zip entries and continue with the rest of the document.
    }

    offset = dataEnd
  }

  return entries
}

function readDocxFile(filePath: string) {
  const entries = readZipEntries(filePath)
  const documentXml = entries.get('word/document.xml')?.toString('utf8') ?? ''
  return stripXmlTags(documentXml)
}

function readXlsxFile(filePath: string) {
  const entries = readZipEntries(filePath)
  const sharedXml = entries.get('xl/sharedStrings.xml')?.toString('utf8') ?? ''
  const sharedStrings = [...sharedXml.matchAll(/<si[\s\S]*?<\/si>/g)].map((match) => stripXmlTags(match[0]))
  const sheets = [...entries.entries()]
    .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort(([a], [b]) => a.localeCompare(b))

  return sheets
    .map(([name, xmlBuffer], sheetIndex) => {
      const xml = xmlBuffer.toString('utf8')
      const rows = [...xml.matchAll(/<row[\s\S]*?<\/row>/g)]
        .slice(0, 120)
        .map((rowMatch) => {
          return [...rowMatch[0].matchAll(/<c([^>]*)>[\s\S]*?<v>([\s\S]*?)<\/v>[\s\S]*?<\/c>/g)]
            .map((cellMatch) => {
              const isSharedString = /t="s"/.test(cellMatch[1])
              const rawValue = stripXmlTags(cellMatch[2])
              return isSharedString ? sharedStrings[Number(rawValue)] ?? rawValue : rawValue
            })
            .join('\t')
        })
        .filter(Boolean)
        .join('\n')

      return `# Sheet ${sheetIndex + 1} (${path.basename(name)})\n${rows}`
    })
    .join('\n\n')
}

function readPptxFile(filePath: string) {
  const entries = readZipEntries(filePath)
  return [...entries.entries()]
    .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, xmlBuffer], index) => `# Slide ${index + 1} (${path.basename(name)})\n${stripXmlTags(xmlBuffer.toString('utf8'))}`)
    .join('\n\n')
}

function readPdfFile(filePath: string) {
  const raw = fs.readFileSync(filePath).toString('latin1')
  const literalTexts = [...raw.matchAll(/\(([^()]{2,500})\)\s*Tj/g)].map((match) => match[1])
  const arrayTexts = [...raw.matchAll(/\[((?:\([^()]{1,200}\)\s*)+)\]\s*TJ/g)].map((match) =>
    [...match[1].matchAll(/\(([^()]{1,200})\)/g)].map((textMatch) => textMatch[1]).join(''),
  )
  const text = [...literalTexts, ...arrayTexts]
    .join('\n')
    .replace(/\\([()\\])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

  return text || '已识别为 PDF 文件，但当前内置解析器没有抽取到可读文本。扫描版 PDF 需要后续接 OCR 或专业 PDF 解析库。'
}

function readImageInfo(filePath: string) {
  const buffer = fs.readFileSync(filePath)
  const extension = path.extname(filePath).toLowerCase()
  let sizeText = '未知尺寸'

  if (extension === '.png' && buffer.length > 24) {
    sizeText = `${buffer.readUInt32BE(16)} x ${buffer.readUInt32BE(20)}`
  }

  if ((extension === '.jpg' || extension === '.jpeg') && buffer.length > 4) {
    let offset = 2
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) {
        break
      }
      const marker = buffer[offset + 1]
      const length = buffer.readUInt16BE(offset + 2)
      if (marker >= 0xc0 && marker <= 0xc3) {
        sizeText = `${buffer.readUInt16BE(offset + 7)} x ${buffer.readUInt16BE(offset + 5)}`
        break
      }
      offset += 2 + length
    }
  }

  return `这是一个图片文件。\n文件名：${path.basename(filePath)}\n格式：${extension}\n大小：${Math.round(buffer.length / 1024)} KB\n尺寸：${sizeText}\n\n当前版本可以识别图片元信息，但还不能读取图片中的文字。要分析截图、票据、表格图片，需要后续接 OCR Tool。`
}

function readSupportedFile(filePath: string): PickedTextFile {
  const extension = path.extname(filePath).toLowerCase()
  let content = ''

  if (plainTextExtensions.has(extension)) {
    content = fs.readFileSync(filePath, 'utf8')
  } else if (extension === '.docx') {
    content = readDocxFile(filePath)
  } else if (extension === '.xlsx') {
    content = readXlsxFile(filePath)
  } else if (extension === '.pptx') {
    content = readPptxFile(filePath)
  } else if (extension === '.pdf') {
    content = readPdfFile(filePath)
  } else if (imageExtensions.has(extension)) {
    content = readImageInfo(filePath)
  } else {
    content = `暂不支持直接读取 ${extension || '未知'} 格式。`
  }

  return {
    name: path.basename(filePath),
    path: filePath,
    content: content.slice(0, 12000),
  }
}

function getDesktopPath() {
  return path.join(os.homedir(), 'Desktop')
}

function findDesktopTextFile(query: string) {
  const desktopPath = getDesktopPath()
  if (!fs.existsSync(desktopPath)) {
    return null
  }

  const normalizedQuery = query
    .toLowerCase()
    .replace(/桌面|文件|打开|读取|分析|看看|请|帮我|能不能|可以|一下/g, ' ')
    .replace(/[“”"']/g, ' ')
    .trim()

  if (!normalizedQuery) {
    return null
  }

  const candidates = fs
    .readdirSync(desktopPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(desktopPath, entry.name))
    .filter((filePath) => supportedFileExtensions.has(path.extname(filePath).toLowerCase()))

  return (
    candidates.find((filePath) => path.basename(filePath).toLowerCase().includes(normalizedQuery)) ??
    candidates.find((filePath) => normalizedQuery.includes(path.basename(filePath).toLowerCase())) ??
    null
  )
}

function readDirectoryTextFiles(directoryPath: string) {
  const files = fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(directoryPath, entry.name))
    .filter((filePath) => supportedFileExtensions.has(path.extname(filePath).toLowerCase()))
    .slice(0, 20)

  return files.map(readSupportedFile)
}

function getConfigPath() {
  return path.join(app.getPath('userData'), 'agent-platform-config.json')
}

function getWorkspaceDataPath() {
  return path.join(app.getPath('userData'), 'butler-workspace-data.json')
}

function getAgentRunsPath() {
  return path.join(app.getPath('userData'), 'agent-runs.json')
}

function readAgentRuns(): StoredAgentRun[] {
  const dataPath = getAgentRunsPath()
  if (!fs.existsSync(dataPath)) return []

  try {
    const savedRuns = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
    return Array.isArray(savedRuns) ? savedRuns : []
  } catch {
    return []
  }
}

function saveAgentRun(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Invalid Agent run')
  const run = value as Partial<StoredAgentRun>
  if (typeof run.id !== 'string' || typeof run.goal !== 'string' || typeof run.startedAt !== 'number') {
    throw new Error('Agent run is missing required fields')
  }

  const allowedStatuses = new Set<StoredAgentRun['status']>(['running', 'completed', 'blocked', 'failed'])
  const savedRun: StoredAgentRun = {
    id: run.id.slice(0, 120),
    goal: run.goal.slice(0, 4000),
    status: run.status && allowedStatuses.has(run.status) ? run.status : 'failed',
    turns: Math.max(0, Math.min(Number(run.turns) || 0, 20)),
    startedAt: run.startedAt,
    finishedAt: typeof run.finishedAt === 'number' ? run.finishedAt : undefined,
    observations: Array.isArray(run.observations) ? run.observations.slice(0, 30) : [],
    final: typeof run.final === 'string' ? run.final.slice(0, 12000) : undefined,
    error: typeof run.error === 'string' ? run.error.slice(0, 2000) : undefined,
  }
  const nextRuns = [savedRun, ...readAgentRuns().filter((item) => item.id !== savedRun.id)].slice(0, 100)
  const dataPath = getAgentRunsPath()
  fs.mkdirSync(path.dirname(dataPath), { recursive: true })
  fs.writeFileSync(dataPath, `${JSON.stringify(nextRuns, null, 2)}\n`, 'utf8')
  return savedRun
}

function createDefaultWorkspaceData(): ButlerWorkspaceData {
  return {
    reports: [],
    plans: [],
    activities: [],
  }
}

function readWorkspaceData(): ButlerWorkspaceData {
  const dataPath = getWorkspaceDataPath()

  if (!fs.existsSync(dataPath)) {
    return createDefaultWorkspaceData()
  }

  try {
    const savedData = JSON.parse(fs.readFileSync(dataPath, 'utf8')) as Partial<ButlerWorkspaceData>
    return {
      reports: Array.isArray(savedData.reports) ? savedData.reports : [],
      plans: Array.isArray(savedData.plans) ? savedData.plans : [],
      activities: Array.isArray(savedData.activities) ? savedData.activities : [],
    }
  } catch {
    return createDefaultWorkspaceData()
  }
}

function saveWorkspaceData(data: ButlerWorkspaceData) {
  const dataPath = getWorkspaceDataPath()
  fs.mkdirSync(path.dirname(dataPath), { recursive: true })
  fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  return readWorkspaceData()
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function appendActivity(data: ButlerWorkspaceData, activity: Omit<ButlerActivity, 'id' | 'createdAt'>) {
  data.activities = [
    {
      id: createId('activity'),
      createdAt: Date.now(),
      ...activity,
    },
    ...data.activities,
  ].slice(0, 80)
}

function openFloatingReport(report: ButlerReport) {
  floatingReportWindow?.close()

  floatingReportWindow = new BrowserWindow({
    title: `报告：${report.title}`,
    width: 380,
    height: 520,
    minWidth: 320,
    minHeight: 360,
    alwaysOnTop: true,
    resizable: true,
    frame: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  floatingReportWindow.on('closed', () => {
    floatingReportWindow = null
  })

  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <style>
      :root { color: #0f172a; background: #f8fafc; font-family: "Segoe UI", system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 18px; overflow: auto; }
      .eyebrow { color: #0f766e; font-size: 11px; font-weight: 900; text-transform: uppercase; }
      h1 { margin: 6px 0 10px; font-size: 20px; line-height: 1.25; }
      .summary { margin: 0 0 14px; padding: 12px; border: 1px solid rgba(20, 184, 166, 0.24); border-radius: 8px; background: #ecfeff; line-height: 1.6; }
      pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.7; font-family: inherit; }
      footer { margin-top: 16px; color: #64748b; font-size: 12px; }
    </style>
  </head>
  <body>
    <div class="eyebrow">Floating Report</div>
    <h1>${escapeHtml(report.title)}</h1>
    <p class="summary">${escapeHtml(report.summary)}</p>
    <pre>${escapeHtml(report.content)}</pre>
    <footer>${new Date(report.createdAt).toLocaleString('zh-CN')}</footer>
  </body>
</html>`

  floatingReportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function getExtensionsPath() {
  const extensionsPath = path.join(app.getPath('userData'), 'extensions')
  fs.mkdirSync(path.join(extensionsPath, 'skills'), { recursive: true })
  fs.mkdirSync(path.join(extensionsPath, 'tools'), { recursive: true })
  return extensionsPath
}

function createExtensionId(kind: 'skill' | 'tool', filePath: string) {
  return `extension:${kind}:${path.basename(filePath).toLowerCase()}`
}

function parseExtensionSkill(filePath: string): CustomSkillConfig | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8').trim()
    const extension = path.extname(filePath).toLowerCase()

    if (extension === '.json') {
      const parsed = JSON.parse(content) as Partial<CustomSkillConfig>
      return {
        id: createExtensionId('skill', filePath),
        name: parsed.name?.trim() || path.basename(filePath, extension),
        description: parsed.description?.trim() || '扩展目录加载的 Prompt Skill',
        prompt: parsed.prompt?.trim() || content,
        enabled: parsed.enabled !== false,
        source: 'extension',
      }
    }

    if (extension === '.md' || extension === '.txt') {
      const heading = content
        .split(/\r?\n/)
        .find((line) => line.trim().startsWith('#'))
        ?.replace(/^#+\s*/, '')
        .trim()

      return {
        id: createExtensionId('skill', filePath),
        name: heading || path.basename(filePath, extension),
        description: '扩展目录加载的 Prompt Skill',
        prompt: content,
        enabled: true,
        source: 'extension',
      }
    }

    return null
  } catch {
    return null
  }
}

function parseExtensionTool(filePath: string): CustomToolConfig | null {
  try {
    const extension = path.extname(filePath).toLowerCase()
    if (extension !== '.json') {
      return null
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<CustomToolConfig>
    if (!parsed.endpoint) {
      return null
    }

    return {
      id: createExtensionId('tool', filePath),
      name: parsed.name?.trim() || path.basename(filePath, extension),
      description: parsed.description?.trim() || '扩展目录加载的 HTTP API Tool',
      endpoint: parsed.endpoint.trim(),
      method: parsed.method === 'GET' ? 'GET' : 'POST',
      apiKey: parsed.apiKey?.trim() || undefined,
      enabled: parsed.enabled !== false,
      source: 'extension',
    }
  } catch {
    return null
  }
}

function scanExtensionConfigs() {
  const extensionsPath = getExtensionsPath()
  const skillsPath = path.join(extensionsPath, 'skills')
  const toolsPath = path.join(extensionsPath, 'tools')

  const customSkills = fs
    .readdirSync(skillsPath)
    .map((fileName) => parseExtensionSkill(path.join(skillsPath, fileName)))
    .filter((skill): skill is CustomSkillConfig => Boolean(skill))

  const customTools = fs
    .readdirSync(toolsPath)
    .map((fileName) => parseExtensionTool(path.join(toolsPath, fileName)))
    .filter((tool): tool is CustomToolConfig => Boolean(tool))

  return { customSkills, customTools }
}

function createDefaultConfig(): AgentPlatformConfig {
  const zhipuApiKey = localEnv.ZHIPU_API_KEY ?? ''
  const zhipuModel = localEnv.ZHIPU_MODEL ?? 'glm-4-flash'
  const providers: ModelProviderConfig[] = [
    {
      id: 'mock',
      name: '本地演示模型',
      type: 'mock',
      model: 'mock-local',
    },
    {
      id: 'zhipu-default',
      name: '智谱默认模型',
      type: 'zhipu',
      model: zhipuModel,
      apiKey: zhipuApiKey,
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    },
  ]

  return {
    activeProviderId: zhipuApiKey ? 'zhipu-default' : 'mock',
    providers,
    customSkills: [],
    customTools: [],
  }
}

function mergeConfig(savedConfig: Partial<AgentPlatformConfig> | null): AgentPlatformConfig {
  const defaultConfig = createDefaultConfig()
  const extensionConfig = scanExtensionConfigs()

  if (!savedConfig) {
    return {
      ...defaultConfig,
      customSkills: extensionConfig.customSkills,
      customTools: extensionConfig.customTools,
    }
  }

  const providerMap = new Map(defaultConfig.providers.map((provider) => [provider.id, provider]))
  for (const provider of savedConfig.providers ?? []) {
    providerMap.set(provider.id, provider)
  }

  const providers = [...providerMap.values()]
  const activeProviderId = providers.some((provider) => provider.id === savedConfig.activeProviderId)
    ? savedConfig.activeProviderId ?? defaultConfig.activeProviderId
    : defaultConfig.activeProviderId

  return {
    activeProviderId,
    providers,
    customSkills: [
      ...(savedConfig.customSkills ?? []).filter((skill) => !skill.id.startsWith('extension:')),
      ...extensionConfig.customSkills,
    ],
    customTools: [
      ...(savedConfig.customTools ?? []).filter((tool) => !tool.id.startsWith('extension:')),
      ...extensionConfig.customTools,
    ],
  }
}

function encryptSecret(secret?: string) {
  if (!secret || secret.startsWith(SAFE_STORAGE_PREFIX)) return secret
  if (!safeStorage.isEncryptionAvailable()) return secret
  return `${SAFE_STORAGE_PREFIX}${safeStorage.encryptString(secret).toString('base64')}`
}

function decryptSecret(secret?: string) {
  if (!secret?.startsWith(SAFE_STORAGE_PREFIX)) return secret
  if (!safeStorage.isEncryptionAvailable()) return undefined

  try {
    const encryptedValue = Buffer.from(secret.slice(SAFE_STORAGE_PREFIX.length), 'base64')
    return safeStorage.decryptString(encryptedValue)
  } catch {
    return undefined
  }
}

function decryptPlatformConfig(config: Partial<AgentPlatformConfig>): Partial<AgentPlatformConfig> {
  return {
    ...config,
    providers: config.providers?.map((provider) => ({
      ...provider,
      apiKey: decryptSecret(provider.apiKey),
    })),
    customTools: config.customTools?.map((tool) => ({
      ...tool,
      apiKey: decryptSecret(tool.apiKey),
    })),
  }
}

function encryptPlatformConfig(config: AgentPlatformConfig): AgentPlatformConfig {
  return {
    ...config,
    providers: config.providers.map((provider) => ({
      ...provider,
      apiKey: encryptSecret(provider.apiKey),
    })),
    customTools: config.customTools.map((tool) => ({
      ...tool,
      apiKey: encryptSecret(tool.apiKey),
    })),
  }
}

function hasPlaintextSecrets(config: Partial<AgentPlatformConfig>) {
  return [...(config.providers ?? []), ...(config.customTools ?? [])].some(
    (item) => Boolean(item.apiKey) && !item.apiKey?.startsWith(SAFE_STORAGE_PREFIX),
  )
}

function readPlatformConfig(): AgentPlatformConfig {
  const configPath = getConfigPath()

  if (!fs.existsSync(configPath)) {
    return mergeConfig(null)
  }

  try {
    const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<AgentPlatformConfig>
    return mergeConfig(decryptPlatformConfig(savedConfig))
  } catch {
    return createDefaultConfig()
  }
}

function savePlatformConfig(config: AgentPlatformConfig) {
  const configPath = getConfigPath()
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  const encryptedConfig = encryptPlatformConfig(config)
  fs.writeFileSync(configPath, `${JSON.stringify(encryptedConfig, null, 2)}\n`, 'utf8')
  return readPlatformConfig()
}

function migratePlaintextSecrets() {
  const configPath = getConfigPath()
  if (!safeStorage.isEncryptionAvailable()) return

  if (!fs.existsSync(configPath)) {
    const initialConfig = createDefaultConfig()
    if (hasPlaintextSecrets(initialConfig)) savePlatformConfig(initialConfig)
    return
  }

  try {
    const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<AgentPlatformConfig>
    if (hasPlaintextSecrets(savedConfig)) {
      savePlatformConfig(mergeConfig(savedConfig))
    }
  } catch {
    // Keep the existing config untouched if migration cannot be completed safely.
  }
}

function getActiveProvider() {
  const config = readPlatformConfig()
  return config.providers.find((provider) => provider.id === config.activeProviderId) ?? config.providers[0]
}

async function requestChatCompletion(provider: ModelProviderConfig, userText: string) {
  if (provider.type === 'mock') {
    return {
      content: `收到：${userText}\n\n当前使用本地演示模型。你可以在开发者版设置中添加智谱、OpenAI Compatible 或其他兼容接口。`,
    }
  }

  if (!provider.apiKey) {
    return {
      content: `当前模型 Provider「${provider.name}」没有配置 API Key，请在开发者版设置中补充。`,
    }
  }

  const endpoint =
    provider.baseUrl ||
    (provider.type === 'zhipu'
      ? 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
      : 'https://api.openai.com/v1/chat/completions')

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        {
          role: 'system',
          content:
            '你是一个桌面 AI 管家。普通用户版要用通俗语言帮助用户读取本地文件、分析数据、整理资料、生成报告和待办；开发者版可以解释模型 Provider、Skill、Tool、RAG、Agent Loop、Electron IPC 和权限边界。回答要简洁、可靠、偏行动建议。',
        },
        {
          role: 'user',
          content: userText,
        },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`AI provider request failed: ${response.status}`)
  }

  const data = await response.json()
  return {
    content: data.choices?.[0]?.message?.content ?? '模型没有返回内容。',
  }
}

async function requestChatCompletionStream(
  provider: ModelProviderConfig,
  userText: string,
  onDelta: (delta: string) => void,
) {
  if (provider.type === 'mock' || !provider.apiKey) {
    const reply = await requestChatCompletion(provider, userText)
    onDelta(reply.content)
    return reply
  }

  const endpoint =
    provider.baseUrl ||
    (provider.type === 'zhipu'
      ? 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
      : 'https://api.openai.com/v1/chat/completions')
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      stream: true,
      messages: [
        {
          role: 'system',
          content:
            '你是一个桌面 AI 管家。普通用户版要用通俗语言帮助用户读取本地文件、分析数据、整理资料、生成报告和待办；开发者版可以解释模型 Provider、Skill、Tool、RAG、Agent Loop、Electron IPC 和权限边界。回答要简洁、可靠、偏行动建议。',
        },
        { role: 'user', content: userText },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`AI provider stream request failed: ${response.status}`)
  }
  if (!response.body) {
    throw new Error('AI provider did not return a readable stream')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const dataText = line.startsWith('data:') ? line.slice(5).trim() : ''
      if (!dataText || dataText === '[DONE]') continue
      try {
        const payload = JSON.parse(dataText)
        const delta = payload.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta.length > 0) {
          content += delta
          onDelta(delta)
        }
      } catch {
        // Some compatible providers send keep-alive lines that are not JSON.
      }
    }

    if (done) break
  }

  return { content: content || '模型没有返回内容。' }
}

async function createAiReply(userText: string) {
  const provider = getActiveProvider()
  return requestChatCompletion(provider, userText)
}

function extractToolVariables(input: string) {
  const cityMatch =
    input.match(/(?:今天|明天|后天)?([^，。,.?\s]{2,12})(?:的)?天气/) ??
    input.match(/天气.*?(?:在|查|看)?([^，。,.?\s]{2,12})/)

  return {
    input,
    city: cityMatch?.[1]?.replace(/我想|帮我|查询|看看|今天|明天|后天/g, '') || input,
  }
}

function applyToolTemplate(template: string, input: string) {
  const variables = extractToolVariables(input)

  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key as keyof typeof variables] ?? input
    return encodeURIComponent(value)
  })
}

async function invokeCustomTool(toolId: string, input: string) {
  const config = readPlatformConfig()
  const tool = config.customTools.find((item) => item.id === toolId)

  if (!tool) {
    throw new Error(`Custom tool not found: ${toolId}`)
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (tool.apiKey) {
    headers.Authorization = `Bearer ${tool.apiKey}`
  }

  const endpoint = applyToolTemplate(tool.endpoint, input)

  const response = await fetch(endpoint, {
    method: tool.method,
    headers,
    body: tool.method === 'POST' ? JSON.stringify(extractToolVariables(input)) : undefined,
  })

  const text = await response.text()

  if (!response.ok) {
    throw new Error(`Custom tool request failed: ${response.status} ${text.slice(0, 200)}`)
  }

  return {
    name: tool.name,
    content: text.slice(0, 8000),
  }
}

function createMainWindow() {
  const preloadPath = path.join(__dirname, 'preload.js')

  mainWindow = new BrowserWindow({
    title: APP_TITLE,
    width: 1200,
    height: 760,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.setTitle(APP_TITLE)
  })

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  } else {
    mainWindow.loadURL(DEV_SERVER_URL)
  }
}

ipcMain.handle('app:get-version', () => {
  return app.getVersion()
})

ipcMain.handle('system:get-info', () => {
  return {
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
  }
})

ipcMain.handle('ai:chat', async (_event, userText: string) => {
  return createAiReply(userText)
})

ipcMain.handle('ai:chat-stream', async (event, requestId: string, userText: string) => {
  const provider = getActiveProvider()
  return requestChatCompletionStream(provider, userText, (delta) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('ai:chat-stream-delta', requestId, delta)
    }
  })
})

ipcMain.handle('platform:get-config', () => {
  return readPlatformConfig()
})

ipcMain.handle('platform:save-config', (_event, config: AgentPlatformConfig) => {
  return savePlatformConfig(config)
})

ipcMain.handle('workflow:get-data', () => {
  return readWorkspaceData()
})

ipcMain.handle('agent-runs:list', () => {
  return readAgentRuns()
})

ipcMain.handle('agent-runs:save', (_event, run: unknown) => {
  return saveAgentRun(run)
})

ipcMain.handle('workflow:save-report', (_event, report: Omit<ButlerReport, 'id' | 'createdAt'>) => {
  const data = readWorkspaceData()
  const savedReport: ButlerReport = {
    id: createId('report'),
    createdAt: Date.now(),
    ...report,
  }
  data.reports = [savedReport, ...data.reports].slice(0, 30)
  appendActivity(data, {
    type: 'report',
    text: `生成报告：${savedReport.title}`,
  })
  return saveWorkspaceData(data)
})

ipcMain.handle('workflow:save-plan', (_event, plan: Omit<ButlerPlan, 'id' | 'status' | 'checkins' | 'createdAt' | 'updatedAt'>) => {
  const data = readWorkspaceData()
  const savedPlan: ButlerPlan = {
    id: createId('plan'),
    title: plan.title,
    description: plan.description,
    status: 'active',
    checkins: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  data.plans = [savedPlan, ...data.plans]
  appendActivity(data, {
    type: 'plan',
    text: `新增计划：${savedPlan.title}`,
  })
  return saveWorkspaceData(data)
})

ipcMain.handle('workflow:update-plan', (_event, planId: string, patch: Partial<ButlerPlan>) => {
  const data = readWorkspaceData()
  data.plans = data.plans.map((plan) =>
    plan.id === planId
      ? {
          ...plan,
          ...patch,
          id: plan.id,
          createdAt: plan.createdAt,
          updatedAt: Date.now(),
        }
      : plan,
  )
  appendActivity(data, {
    type: 'plan',
    text: `修改计划：${data.plans.find((plan) => plan.id === planId)?.title ?? planId}`,
  })
  return saveWorkspaceData(data)
})

ipcMain.handle('workflow:delete-plan', (_event, planId: string) => {
  const data = readWorkspaceData()
  const targetPlan = data.plans.find((plan) => plan.id === planId)
  data.plans = data.plans.filter((plan) => plan.id !== planId)
  appendActivity(data, {
    type: 'plan',
    text: `删除计划：${targetPlan?.title ?? planId}`,
  })
  return saveWorkspaceData(data)
})

ipcMain.handle('workflow:checkin-plan', (_event, planId: string, note: string) => {
  const data = readWorkspaceData()
  data.plans = data.plans.map((plan) =>
    plan.id === planId
      ? {
          ...plan,
          checkins: plan.checkins + 1,
          lastCheckinAt: Date.now(),
          updatedAt: Date.now(),
        }
      : plan,
  )
  const targetPlan = data.plans.find((plan) => plan.id === planId)
  appendActivity(data, {
    type: 'checkin',
    text: `进度记录：${targetPlan?.title ?? planId}${note ? `｜${note}` : ''}`,
  })
  return saveWorkspaceData(data)
})

ipcMain.handle('workflow:add-activity', (_event, text: string) => {
  const data = readWorkspaceData()
  appendActivity(data, {
    type: 'note',
    text,
  })
  return saveWorkspaceData(data)
})

ipcMain.handle('workflow:notify', (_event, title: string, body: string) => {
  if (!Notification.isSupported()) {
    return false
  }

  new Notification({
    title,
    body,
  }).show()
  return true
})

ipcMain.handle('workflow:open-floating-report', (_event, reportId: string) => {
  const data = readWorkspaceData()
  const report = data.reports.find((item) => item.id === reportId)
  if (!report) {
    return false
  }

  openFloatingReport(report)
  return true
})

ipcMain.handle('platform:get-extensions-path', () => {
  return getExtensionsPath()
})

ipcMain.handle('platform:open-extensions-folder', async () => {
  const extensionsPath = getExtensionsPath()
  await shell.openPath(extensionsPath)
  return extensionsPath
})

ipcMain.handle('tool:invoke-custom', async (_event, toolId: string, input: string) => {
  return invokeCustomTool(toolId, input)
})

ipcMain.handle('file:pick-text', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择要读取的本地文件',
    properties: ['openFile'],
    filters: [
      {
        name: 'Supported files',
        extensions: [
          'txt',
          'md',
          'json',
          'log',
          'csv',
          'tsv',
          'html',
          'xml',
          'yaml',
          'yml',
          'docx',
          'xlsx',
          'pptx',
          'pdf',
          'png',
          'jpg',
          'jpeg',
          'gif',
          'webp',
          'bmp',
          'js',
          'ts',
          'tsx',
          'css',
          'py',
          'java',
          'sql',
        ],
      },
      { name: 'All files', extensions: ['*'] },
    ],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const filePath = result.filePaths[0]
  return readSupportedFile(filePath)
})

ipcMain.handle('file:pick-text-many', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择要添加到聊天的文件',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Supported files',
        extensions: [
          'txt',
          'md',
          'json',
          'log',
          'csv',
          'tsv',
          'html',
          'xml',
          'yaml',
          'yml',
          'docx',
          'xlsx',
          'pptx',
          'pdf',
          'png',
          'jpg',
          'jpeg',
          'gif',
          'webp',
          'bmp',
          'js',
          'ts',
          'tsx',
          'css',
          'py',
          'java',
          'sql',
        ],
      },
      { name: 'All files', extensions: ['*'] },
    ],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return []
  }

  return result.filePaths.slice(0, 10).map(readSupportedFile)
})

ipcMain.handle('file:pick-directory-text', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择要读取的文件夹',
    properties: ['openDirectory'],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return []
  }

  return readDirectoryTextFiles(result.filePaths[0])
})

ipcMain.handle('file:read-dropped', async (_event, filePath: string) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return null
  }

  const stat = fs.statSync(filePath)
  if (!stat.isFile()) {
    return null
  }

  const extension = path.extname(filePath).toLowerCase()
  if (!supportedFileExtensions.has(extension)) {
    return {
      name: path.basename(filePath),
      path: filePath,
      content: `暂不支持直接读取 ${extension || '未知'} 格式。`,
    }
  }

  return readSupportedFile(filePath)
})

ipcMain.handle('file:read-named-text', async (_event, query: string) => {
  const filePath = findDesktopTextFile(query)

  if (!filePath) {
    return null
  }

  return readSupportedFile(filePath)
})

ipcMain.handle('window:toggle-always-on-top', () => {
  if (!mainWindow) {
    return false
  }

  const nextValue = !mainWindow.isAlwaysOnTop()
  mainWindow.setAlwaysOnTop(nextValue)
  return nextValue
})

app.whenReady().then(() => {
  migratePlaintextSecrets()
  createMainWindow()
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (!mainWindow) {
      return
    }

    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  try {
    tray = new Tray(path.join(appRoot, 'public', 'favicon.svg'))
    tray.setToolTip(APP_TITLE)
    tray.on('click', () => {
      mainWindow?.show()
      mainWindow?.focus()
    })
  } catch {
    tray = null
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  tray = null
})
