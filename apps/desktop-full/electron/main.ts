import { app, BrowserWindow, Notification, Tray, dialog, globalShortcut, ipcMain, safeStorage, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { chunkKnowledgeContent, createKnowledgeSearchTerms } from './knowledge-utils.js'
import { readXlsxFile } from './excel-parser.js'

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
  priority: 'low' | 'medium' | 'high'
  dueDate?: string
  recurrence: 'none' | 'daily' | 'weekly'
  progress: number
  nextAction?: string
  completedAt?: number
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

type KnowledgeDocumentInput = {
  id: string | number
  name: string
  content: string
  createdAt: number
}

type KnowledgeSearchResult = {
  documentId: string
  documentName: string
  chunkIndex: number
  content: string
  score: number
}

type AuditLogLevel = 'info' | 'warn' | 'error'
type AuditLogStatus = 'success' | 'failure' | 'pending'
type AuditLogCategory = 'system' | 'agent' | 'tool' | 'file' | 'knowledge' | 'workflow' | 'security'

type AuditLogInput = {
  level?: AuditLogLevel
  category: AuditLogCategory
  action: string
  summary: string
  detail?: unknown
  status?: AuditLogStatus
  runId?: string
  durationMs?: number
  metadata?: Record<string, unknown>
}

type AuditLogFilters = {
  level?: AuditLogLevel | 'all'
  category?: AuditLogCategory | 'all'
  status?: AuditLogStatus | 'all'
  query?: string
  limit?: number
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
let database: DatabaseSync | null = null

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

async function readSupportedFile(filePath: string): Promise<PickedTextFile> {
  const extension = path.extname(filePath).toLowerCase()
  let content = ''

  if (plainTextExtensions.has(extension)) {
    content = fs.readFileSync(filePath, 'utf8')
  } else if (extension === '.docx') {
    content = readDocxFile(filePath)
  } else if (extension === '.xlsx') {
    content = await readXlsxFile(filePath)
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

async function readDirectoryTextFiles(directoryPath: string) {
  const files = fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(directoryPath, entry.name))
    .filter((filePath) => supportedFileExtensions.has(path.extname(filePath).toLowerCase()))
    .slice(0, 20)

  return Promise.all(files.map(readSupportedFile))
}

function getConfigPath() {
  return path.join(app.getPath('userData'), 'agent-platform-config.json')
}

function getLegacyWorkspaceDataPath() {
  return path.join(app.getPath('userData'), 'butler-workspace-data.json')
}

function getLegacyAgentRunsPath() {
  return path.join(app.getPath('userData'), 'agent-runs.json')
}

function getDatabasePath() {
  return path.join(app.getPath('userData'), 'butler-data.sqlite')
}

function getApplicationVersion() {
  if (app.isPackaged) return app.getVersion()
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof packageJson.version === 'string' ? packageJson.version : app.getVersion()
  } catch {
    return app.getVersion()
  }
}

function createDefaultWorkspaceData(): ButlerWorkspaceData {
  return {
    reports: [],
    plans: [],
    activities: [],
  }
}

function readLegacyAgentRuns(): StoredAgentRun[] {
  const dataPath = getLegacyAgentRunsPath()
  if (!fs.existsSync(dataPath)) return []

  try {
    const savedRuns = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
    return Array.isArray(savedRuns) ? savedRuns : []
  } catch {
    return []
  }
}

function readLegacyWorkspaceData(): ButlerWorkspaceData {
  const dataPath = getLegacyWorkspaceDataPath()

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

function initializeDatabase() {
  if (database) return database

  const databasePath = getDatabasePath()
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  database = new DatabaseSync(databasePath)
  database.exec('PRAGMA journal_mode = WAL')
  database.exec('PRAGMA foreign_keys = ON')
  database.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      checkins INTEGER NOT NULL DEFAULT 0,
      last_checkin_at INTEGER,
      reminder_time TEXT,
      last_reminder_date TEXT,
      priority TEXT NOT NULL DEFAULT 'medium',
      due_date TEXT,
      recurrence TEXT NOT NULL DEFAULT 'none',
      progress INTEGER NOT NULL DEFAULT 0,
      next_action TEXT,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_notes (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'context',
      pinned INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      goal TEXT NOT NULL,
      status TEXT NOT NULL,
      turns INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      observations_json TEXT NOT NULL,
      final_text TEXT,
      error_text TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      level TEXT NOT NULL,
      category TEXT NOT NULL,
      action TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail TEXT,
      status TEXT NOT NULL,
      run_id TEXT,
      duration_ms INTEGER,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id TEXT NOT NULL,
      document_name TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      FOREIGN KEY(document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_plans_updated_at ON plans(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_activities_created_at ON activities(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_notes_created_at ON memory_notes(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_started_at ON agent_runs(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON audit_logs(category, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_status ON audit_logs(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document_id ON knowledge_chunks(document_id);
  `)
  const planColumns = new Set(
    (database.prepare('PRAGMA table_info(plans)').all() as Array<{ name: string }>).map((column) => column.name),
  )
  const planMigrations = [
    ['priority', "ALTER TABLE plans ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'"],
    ['due_date', 'ALTER TABLE plans ADD COLUMN due_date TEXT'],
    ['recurrence', "ALTER TABLE plans ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none'"],
    ['progress', 'ALTER TABLE plans ADD COLUMN progress INTEGER NOT NULL DEFAULT 0'],
    ['next_action', 'ALTER TABLE plans ADD COLUMN next_action TEXT'],
    ['completed_at', 'ALTER TABLE plans ADD COLUMN completed_at INTEGER'],
  ] as const
  for (const [column, migration] of planMigrations) {
    if (!planColumns.has(column)) database.exec(migration)
  }
  const memoryColumns = new Set(
    (database.prepare('PRAGMA table_info(memory_notes)').all() as Array<{ name: string }>).map((column) => column.name),
  )
  const memoryMigrations = [
    ['category', "ALTER TABLE memory_notes ADD COLUMN category TEXT NOT NULL DEFAULT 'context'"],
    ['pinned', 'ALTER TABLE memory_notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0'],
    ['expires_at', 'ALTER TABLE memory_notes ADD COLUMN expires_at INTEGER'],
    ['updated_at', 'ALTER TABLE memory_notes ADD COLUMN updated_at INTEGER'],
  ] as const
  for (const [column, migration] of memoryMigrations) {
    if (!memoryColumns.has(column)) database.exec(migration)
  }
  database.prepare('UPDATE memory_notes SET updated_at = created_at WHERE updated_at IS NULL').run()
  try {
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
        document_id UNINDEXED,
        document_name UNINDEXED,
        chunk_index UNINDEXED,
        content,
        tokenize='trigram'
      );
    `)
  } catch {
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
        document_id UNINDEXED,
        document_name UNINDEXED,
        chunk_index UNINDEXED,
        content,
        tokenize='unicode61'
      );
    `)
  }
  migrateLegacyData(database)
  const interruptedRuns = database
    .prepare(
      `UPDATE agent_runs
       SET status = 'blocked', finished_at = ?, error_text = COALESCE(error_text, '应用上次退出时任务仍在运行，请重新执行。')
       WHERE status = 'running'`,
    )
    .run(Date.now())
  if (interruptedRuns.changes > 0) {
    writeAuditLog({
      level: 'warn',
      category: 'agent',
      action: 'agent.run.recover',
      summary: `发现 ${interruptedRuns.changes} 个中断任务，已标记为受阻`,
      metadata: { recovered: interruptedRuns.changes },
    })
  }
  const expiredMemories = database.prepare('DELETE FROM memory_notes WHERE expires_at IS NOT NULL AND expires_at <= ?').run(Date.now())
  if (expiredMemories.changes > 0) {
    writeAuditLog({ category: 'workflow', action: 'memory.expire', summary: `已清理 ${expiredMemories.changes} 条过期记忆`, metadata: { deleted: expiredMemories.changes } })
  }
  return database
}

function isMigrationComplete(db: DatabaseSync, key: string) {
  return Boolean(db.prepare('SELECT value FROM metadata WHERE key = ?').get(key))
}

function markMigrationComplete(db: DatabaseSync, key: string) {
  db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)').run(key, new Date().toISOString())
}

function replaceWorkspaceData(db: DatabaseSync, data: ButlerWorkspaceData) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec('DELETE FROM reports; DELETE FROM plans; DELETE FROM activities;')
    const insertReport = db.prepare(
      'INSERT INTO reports (id, title, summary, content, source, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    const insertPlan = db.prepare(
      `INSERT INTO plans
        (id, title, description, status, checkins, last_checkin_at, reminder_time, last_reminder_date,
         priority, due_date, recurrence, progress, next_action, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const insertActivity = db.prepare(
      'INSERT INTO activities (id, type, text, created_at) VALUES (?, ?, ?, ?)',
    )

    for (const report of data.reports) {
      insertReport.run(report.id, report.title, report.summary, report.content, report.source, report.createdAt)
    }
    for (const plan of data.plans) {
      insertPlan.run(
        plan.id,
        plan.title,
        plan.description,
        plan.status,
        plan.checkins,
        plan.lastCheckinAt ?? null,
        plan.reminderTime ?? null,
        plan.lastReminderDate ?? null,
        plan.priority ?? 'medium',
        plan.dueDate ?? null,
        plan.recurrence ?? 'none',
        Math.max(0, Math.min(plan.progress ?? 0, 100)),
        plan.nextAction ?? null,
        plan.completedAt ?? null,
        plan.createdAt,
        plan.updatedAt,
      )
    }
    for (const activity of data.activities) {
      insertActivity.run(activity.id, activity.type, activity.text, activity.createdAt)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function insertAgentRun(db: DatabaseSync, run: StoredAgentRun) {
  db.prepare(
    `INSERT OR REPLACE INTO agent_runs
      (id, goal, status, turns, started_at, finished_at, observations_json, final_text, error_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    run.id,
    run.goal,
    run.status,
    run.turns,
    run.startedAt,
    run.finishedAt ?? null,
    JSON.stringify(run.observations),
    run.final ?? null,
    run.error ?? null,
  )
}

function migrateLegacyData(db: DatabaseSync) {
  if (!isMigrationComplete(db, 'legacy-workspace-json-v1')) {
    replaceWorkspaceData(db, readLegacyWorkspaceData())
    markMigrationComplete(db, 'legacy-workspace-json-v1')
  }

  if (!isMigrationComplete(db, 'legacy-agent-runs-json-v1')) {
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const run of readLegacyAgentRuns()) insertAgentRun(db, run)
      markMigrationComplete(db, 'legacy-agent-runs-json-v1')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

function readAgentRuns(): StoredAgentRun[] {
  const rows = initializeDatabase()
    .prepare(
      `SELECT id, goal, status, turns, started_at AS startedAt, finished_at AS finishedAt,
        observations_json AS observationsJson, final_text AS finalText, error_text AS errorText
      FROM agent_runs ORDER BY started_at DESC LIMIT 100`,
    )
    .all() as Array<{
      id: string
      goal: string
      status: StoredAgentRun['status']
      turns: number
      startedAt: number
      finishedAt: number | null
      observationsJson: string
      finalText: string | null
      errorText: string | null
    }>

  return rows.map((row) => {
    let observations: unknown[] = []
    try {
      const parsed = JSON.parse(row.observationsJson)
      observations = Array.isArray(parsed) ? parsed : []
    } catch {
      observations = []
    }
    return {
      id: row.id,
      goal: row.goal,
      status: row.status,
      turns: row.turns,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt ?? undefined,
      observations,
      final: row.finalText ?? undefined,
      error: row.errorText ?? undefined,
    }
  })
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
  const db = initializeDatabase()
  insertAgentRun(db, savedRun)
  db.exec(
    'DELETE FROM agent_runs WHERE id NOT IN (SELECT id FROM agent_runs ORDER BY started_at DESC LIMIT 100)',
  )
  writeAuditLog({
    level: savedRun.status === 'failed' ? 'error' : savedRun.status === 'blocked' ? 'warn' : 'info',
    category: 'agent',
    action: 'agent.run.save',
    summary: `Agent 任务${savedRun.status === 'completed' ? '完成' : savedRun.status === 'failed' ? '失败' : savedRun.status === 'blocked' ? '受阻' : '运行中'}：${savedRun.goal.slice(0, 120)}`,
    detail: savedRun.error,
    status: savedRun.status === 'failed' ? 'failure' : savedRun.status === 'running' ? 'pending' : 'success',
    runId: savedRun.id,
    durationMs: savedRun.finishedAt ? savedRun.finishedAt - savedRun.startedAt : undefined,
    metadata: { turns: savedRun.turns, observations: savedRun.observations.length },
  })
  return savedRun
}

function readWorkspaceData(): ButlerWorkspaceData {
  const db = initializeDatabase()
  const reports = db
    .prepare(
      'SELECT id, title, summary, content, source, created_at AS createdAt FROM reports ORDER BY created_at DESC',
    )
    .all() as ButlerReport[]
  const planRows = db
    .prepare(
      `SELECT id, title, description, status, checkins, last_checkin_at AS lastCheckinAt,
        reminder_time AS reminderTime, last_reminder_date AS lastReminderDate,
        priority, due_date AS dueDate, recurrence, progress, next_action AS nextAction,
        completed_at AS completedAt,
        created_at AS createdAt, updated_at AS updatedAt
      FROM plans ORDER BY updated_at DESC`,
    )
    .all() as Array<ButlerPlan & {
      lastCheckinAt: number | null
      reminderTime: string | null
      lastReminderDate: string | null
      dueDate: string | null
      nextAction: string | null
      completedAt: number | null
    }>
  const activities = db
    .prepare('SELECT id, type, text, created_at AS createdAt FROM activities ORDER BY created_at DESC')
    .all() as ButlerActivity[]

  return {
    reports,
    plans: planRows.map((plan) => ({
      ...plan,
      lastCheckinAt: plan.lastCheckinAt ?? undefined,
      reminderTime: plan.reminderTime ?? undefined,
      lastReminderDate: plan.lastReminderDate ?? undefined,
      priority: ['low', 'medium', 'high'].includes(plan.priority) ? plan.priority : 'medium',
      dueDate: plan.dueDate ?? undefined,
      recurrence: ['none', 'daily', 'weekly'].includes(plan.recurrence) ? plan.recurrence : 'none',
      progress: Math.max(0, Math.min(Number(plan.progress) || 0, 100)),
      nextAction: plan.nextAction ?? undefined,
      completedAt: plan.completedAt ?? undefined,
    })),
    activities,
  }
}

function saveWorkspaceData(data: ButlerWorkspaceData) {
  replaceWorkspaceData(initializeDatabase(), data)
  return readWorkspaceData()
}

function normalizeKnowledgeDocument(value: unknown): KnowledgeDocumentInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid knowledge document')
  const document = value as Partial<KnowledgeDocumentInput>
  if (
    (typeof document.id !== 'string' && typeof document.id !== 'number') ||
    typeof document.name !== 'string' ||
    typeof document.content !== 'string'
  ) {
    throw new Error('Knowledge document is missing required fields')
  }
  return {
    id: document.id,
    name: document.name.slice(0, 300),
    content: document.content.slice(0, 1_000_000),
    createdAt: typeof document.createdAt === 'number' ? document.createdAt : Date.now(),
  }
}

function upsertKnowledgeDocument(value: unknown) {
  const document = normalizeKnowledgeDocument(value)
  const documentId = String(document.id)
  const chunks = chunkKnowledgeContent(document.content)
  const db = initializeDatabase()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(
      `INSERT INTO knowledge_documents (id, name, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, content = excluded.content, updated_at = excluded.updated_at`,
    ).run(documentId, document.name, document.content, document.createdAt, Date.now())
    db.prepare('DELETE FROM knowledge_chunks WHERE document_id = ?').run(documentId)
    db.prepare('DELETE FROM knowledge_chunks_fts WHERE document_id = ?').run(documentId)
    const insertChunk = db.prepare(
      'INSERT INTO knowledge_chunks (document_id, document_name, chunk_index, content) VALUES (?, ?, ?, ?)',
    )
    const insertSearchChunk = db.prepare(
      'INSERT INTO knowledge_chunks_fts (document_id, document_name, chunk_index, content) VALUES (?, ?, ?, ?)',
    )
    chunks.forEach((chunk, chunkIndex) => {
      insertChunk.run(documentId, document.name, chunkIndex, chunk)
      insertSearchChunk.run(documentId, document.name, chunkIndex, chunk)
    })
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    writeAuditLog({ category: 'knowledge', action: 'knowledge.upsert', summary: `资料入库失败：${document.name}`, detail: error, status: 'failure' })
    throw error
  }
  writeAuditLog({ category: 'knowledge', action: 'knowledge.upsert', summary: `资料已入库：${document.name}`, metadata: { documentId, chunks: chunks.length, characters: document.content.length } })
  return { id: documentId, name: document.name, createdAt: document.createdAt, chunkCount: chunks.length }
}

function syncKnowledgeDocuments(values: unknown) {
  if (!Array.isArray(values)) return []
  return values.slice(0, 50).map(upsertKnowledgeDocument)
}

function listKnowledgeDocuments() {
  return initializeDatabase()
    .prepare(
      `SELECT documents.id, documents.name, documents.created_at AS createdAt,
        documents.updated_at AS updatedAt, COUNT(chunks.id) AS chunkCount,
        LENGTH(documents.content) AS characterCount
      FROM knowledge_documents AS documents
      LEFT JOIN knowledge_chunks AS chunks ON chunks.document_id = documents.id
      GROUP BY documents.id
      ORDER BY documents.updated_at DESC`,
    )
    .all()
}

function deleteKnowledgeDocument(documentId: string) {
  const safeId = String(documentId).slice(0, 160)
  const db = initializeDatabase()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('DELETE FROM knowledge_chunks_fts WHERE document_id = ?').run(safeId)
    const result = db.prepare('DELETE FROM knowledge_documents WHERE id = ?').run(safeId)
    db.exec('COMMIT')
    writeAuditLog({ category: 'knowledge', action: 'knowledge.delete', summary: result.changes > 0 ? '已删除资料库文档' : '未找到要删除的资料库文档', status: result.changes > 0 ? 'success' : 'failure', metadata: { documentId: safeId } })
    return { deleted: result.changes > 0, id: safeId }
  } catch (error) {
    db.exec('ROLLBACK')
    writeAuditLog({ category: 'knowledge', action: 'knowledge.delete', summary: '删除资料库文档失败', detail: error, status: 'failure', metadata: { documentId: safeId } })
    throw error
  }
}

function searchKnowledge(query: string, requestedLimit = 6): KnowledgeSearchResult[] {
  const terms = createKnowledgeSearchTerms(query)
  if (terms.length === 0) return []
  const limit = Math.max(1, Math.min(Number(requestedLimit) || 6, 12))
  const db = initializeDatabase()
  const ftsQuery = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ')

  try {
    const rows = db
      .prepare(
        `SELECT document_id AS documentId, document_name AS documentName,
          CAST(chunk_index AS INTEGER) AS chunkIndex, content,
          bm25(knowledge_chunks_fts) AS rank
        FROM knowledge_chunks_fts
        WHERE knowledge_chunks_fts MATCH ?
        ORDER BY rank ASC LIMIT ?`,
      )
      .all(ftsQuery, limit) as Array<KnowledgeSearchResult & { rank: number }>
    if (rows.length > 0) {
      return rows.map(({ rank, ...row }) => ({ ...row, score: Number((-rank).toFixed(6)) }))
    }
  } catch {
    // Fall back to LIKE search when a platform FTS tokenizer cannot parse a query.
  }

  const fallbackTerms = terms.slice(0, 8)
  const where = fallbackTerms.map(() => 'content LIKE ?').join(' OR ')
  const rows = db
    .prepare(
      `SELECT document_id AS documentId, document_name AS documentName,
        chunk_index AS chunkIndex, content
      FROM knowledge_chunks WHERE ${where} LIMIT ?`,
    )
    .all(...fallbackTerms.map((term) => `%${term}%`), limit) as Array<Omit<KnowledgeSearchResult, 'score'>>
  return rows.map((row) => ({ ...row, score: 0 }))
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function sanitizeAuditText(value: unknown, maxLength: number) {
  if (value === undefined || value === null) return undefined
  return String(value)
    .replace(/(api[_-]?key|authorization|token|secret)(["'\s:=]+)([^\s,"'}]+)/gi, '$1$2[REDACTED]')
    .slice(0, maxLength)
}

function sanitizeAuditMetadata(metadata?: Record<string, unknown>) {
  if (!metadata) return {}
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => !/(api.?key|authorization|token|secret|content|password)/i.test(key))
      .slice(0, 20)
      .map(([key, value]) => [key.slice(0, 80), sanitizeAuditText(value, 500)]),
  )
}

function writeAuditLog(input: AuditLogInput) {
  try {
    const db = initializeDatabase()
    db.prepare(
      `INSERT INTO audit_logs
        (id, created_at, level, category, action, summary, detail, status, run_id, duration_ms, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      createId('log'),
      Date.now(),
      input.level ?? (input.status === 'failure' ? 'error' : 'info'),
      input.category,
      sanitizeAuditText(input.action, 120) ?? 'unknown',
      sanitizeAuditText(input.summary, 500) ?? '',
      sanitizeAuditText(input.detail, 4000) ?? null,
      input.status ?? 'success',
      sanitizeAuditText(input.runId, 160) ?? null,
      typeof input.durationMs === 'number' ? Math.max(0, Math.round(input.durationMs)) : null,
      JSON.stringify(sanitizeAuditMetadata(input.metadata)),
    )
    db.exec(
      'DELETE FROM audit_logs WHERE id NOT IN (SELECT id FROM audit_logs ORDER BY created_at DESC LIMIT 5000)',
    )
  } catch (error) {
    console.error('Failed to persist audit log', error)
  }
}

function listAuditLogs(filters: AuditLogFilters = {}) {
  const clauses: string[] = []
  const params: Array<string | number> = []
  const levels = new Set<AuditLogLevel>(['info', 'warn', 'error'])
  const categories = new Set<AuditLogCategory>(['system', 'agent', 'tool', 'file', 'knowledge', 'workflow', 'security'])
  const statuses = new Set<AuditLogStatus>(['success', 'failure', 'pending'])

  if (filters.level && levels.has(filters.level as AuditLogLevel)) {
    clauses.push('level = ?')
    params.push(filters.level)
  }
  if (filters.category && categories.has(filters.category as AuditLogCategory)) {
    clauses.push('category = ?')
    params.push(filters.category)
  }
  if (filters.status && statuses.has(filters.status as AuditLogStatus)) {
    clauses.push('status = ?')
    params.push(filters.status)
  }
  const query = typeof filters.query === 'string' ? filters.query.trim().slice(0, 200) : ''
  if (query) {
    clauses.push('(summary LIKE ? OR action LIKE ? OR detail LIKE ?)')
    params.push(`%${query}%`, `%${query}%`, `%${query}%`)
  }
  const limit = Math.max(1, Math.min(Number(filters.limit) || 300, 1000))
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  return initializeDatabase()
    .prepare(
      `SELECT id, created_at AS createdAt, level, category, action, summary, detail, status,
        run_id AS runId, duration_ms AS durationMs, metadata_json AS metadataJson
       FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params, limit)
    .map((row) => {
      const item = row as Record<string, unknown>
      let metadata: Record<string, unknown> = {}
      try {
        metadata = JSON.parse(String(item.metadataJson || '{}'))
      } catch {
        metadata = {}
      }
      const { metadataJson: _metadataJson, ...rest } = item
      return { ...rest, metadata }
    })
}

async function exportAuditLogs(filters: AuditLogFilters = {}) {
  const logs = listAuditLogs({ ...filters, limit: 1000 }) as Array<Record<string, unknown>>
  const result = await dialog.showSaveDialog({
    title: '导出审计日志',
    defaultPath: `desktop-ai-butler-audit-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return { exported: false }
  fs.writeFileSync(result.filePath, `${JSON.stringify(logs, null, 2)}\n`, 'utf8')
  writeAuditLog({ category: 'system', action: 'audit.export', summary: `导出 ${logs.length} 条审计日志`, metadata: { count: logs.length } })
  return { exported: true, path: result.filePath, count: logs.length }
}

async function exportUserData() {
  const db = initializeDatabase()
  const knowledgeDocuments = db
    .prepare('SELECT id, name, content, created_at AS createdAt, updated_at AS updatedAt FROM knowledge_documents ORDER BY updated_at DESC')
    .all()
  const platformConfig = readPlatformConfig()
  const safeConfig = {
    ...platformConfig,
    providers: platformConfig.providers.map(({ apiKey: _apiKey, ...provider }) => provider),
    customTools: platformConfig.customTools.map(({ apiKey: _apiKey, ...tool }) => tool),
  }
  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    appVersion: getApplicationVersion(),
    workspace: readWorkspaceData(),
    memoryNotes: readMemoryNotes(),
    knowledgeDocuments,
    agentRuns: readAgentRuns(),
    auditLogs: listAuditLogs({ limit: 1000 }),
    platformConfig: safeConfig,
  }
  const result = await dialog.showSaveDialog({
    title: '导出桌面 AI 管家数据',
    defaultPath: `desktop-ai-butler-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return { exported: false }
  fs.writeFileSync(result.filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  writeAuditLog({ category: 'security', action: 'data.export', summary: '已导出本地数据备份', metadata: { reports: payload.workspace.reports.length, plans: payload.workspace.plans.length, documents: knowledgeDocuments.length } })
  return { exported: true, path: result.filePath }
}

function clearUserData() {
  const db = initializeDatabase()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`
      DELETE FROM reports;
      DELETE FROM plans;
      DELETE FROM activities;
      DELETE FROM memory_notes;
      DELETE FROM agent_runs;
      DELETE FROM knowledge_chunks_fts;
      DELETE FROM knowledge_documents;
    `)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    writeAuditLog({ category: 'security', action: 'data.clear', summary: '清理本地工作数据失败', detail: error, status: 'failure' })
    throw error
  }
  writeAuditLog({ level: 'warn', category: 'security', action: 'data.clear', summary: '已清理报告、计划、行动、记忆、知识库和 Agent 历史' })
  return { cleared: true }
}

function readMemoryNotes() {
  return initializeDatabase()
    .prepare(`SELECT id, text, category, pinned, expires_at AS expiresAt, created_at AS createdAt,
      updated_at AS updatedAt FROM memory_notes
      WHERE expires_at IS NULL OR expires_at > ? ORDER BY pinned DESC, updated_at DESC LIMIT 100`)
    .all(Date.now())
    .map((row) => ({ ...row, pinned: Boolean((row as { pinned: number }).pinned) }))
}

function addMemoryNote(text: string, category = 'context', expiresAt?: number) {
  const normalized = typeof text === 'string' ? text.trim().slice(0, 4000) : ''
  if (!normalized) throw new Error('Memory note cannot be empty')
  const safeCategory = ['preference', 'goal', 'context', 'fact'].includes(category) ? category : 'context'
  const now = Date.now()
  initializeDatabase()
    .prepare('INSERT INTO memory_notes (id, text, category, pinned, expires_at, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)')
    .run(createId('memory'), normalized, safeCategory, typeof expiresAt === 'number' && expiresAt > now ? expiresAt : null, now, now)
  return readMemoryNotes()
}

function syncMemoryNotes(values: unknown) {
  if (!Array.isArray(values)) return readMemoryNotes()
  const db = initializeDatabase()
  const insert = db.prepare('INSERT INTO memory_notes (id, text, category, pinned, expires_at, created_at, updated_at) VALUES (?, ?, ?, 0, NULL, ?, ?)')
  const existing = db.prepare('SELECT text FROM memory_notes').all() as Array<{ text: string }>
  const known = new Set(existing.map((item) => item.text))
  db.exec('BEGIN IMMEDIATE')
  try {
    values.slice(0, 100).forEach((value, index) => {
      if (typeof value !== 'string') return
      const text = value.trim().slice(0, 4000)
      if (!text || known.has(text)) return
      const createdAt = Date.now() - index
      insert.run(createId('memory'), text, 'context', createdAt, createdAt)
      known.add(text)
    })
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return readMemoryNotes()
}

function deleteMemoryNote(noteId: string) {
  initializeDatabase().prepare('DELETE FROM memory_notes WHERE id = ?').run(String(noteId).slice(0, 160))
  return readMemoryNotes()
}

function updateMemoryNote(noteId: string, patch: unknown) {
  if (!patch || typeof patch !== 'object') throw new Error('Invalid memory patch')
  const current = initializeDatabase()
    .prepare('SELECT id, text, category, pinned, expires_at AS expiresAt FROM memory_notes WHERE id = ?')
    .get(String(noteId).slice(0, 160)) as { id: string; text: string; category: string; pinned: number; expiresAt: number | null } | undefined
  if (!current) throw new Error('Memory note not found')
  const value = patch as { text?: unknown; category?: unknown; pinned?: unknown; expiresAt?: unknown }
  const text = typeof value.text === 'string' && value.text.trim() ? value.text.trim().slice(0, 4000) : current.text
  const category = typeof value.category === 'string' && ['preference', 'goal', 'context', 'fact'].includes(value.category) ? value.category : current.category
  const pinned = typeof value.pinned === 'boolean' ? Number(value.pinned) : current.pinned
  const expiresAt = value.expiresAt === null || value.expiresAt === undefined
    ? null
    : typeof value.expiresAt === 'number' && value.expiresAt > Date.now() ? value.expiresAt : current.expiresAt
  initializeDatabase()
    .prepare('UPDATE memory_notes SET text = ?, category = ?, pinned = ?, expires_at = ?, updated_at = ? WHERE id = ?')
    .run(text, category, pinned, expiresAt, Date.now(), current.id)
  return readMemoryNotes()
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

function validateHttpEndpoint(value: string, label: string) {
  let endpoint: URL
  try {
    endpoint = new URL(value)
  } catch {
    throw new Error(`${label} URL 无效`)
  }
  if (!['http:', 'https:'].includes(endpoint.protocol)) {
    throw new Error(`${label} 只允许 HTTP 或 HTTPS`)
  }
  if (endpoint.username || endpoint.password) {
    throw new Error(`${label} URL 不能包含用户名或密码`)
  }
  return endpoint.toString()
}

async function readResponseTextLimited(response: Response, maxCharacters = 1_000_000) {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let content = ''
  while (true) {
    const { done, value } = await reader.read()
    content += decoder.decode(value, { stream: !done })
    if (content.length > maxCharacters) {
      await reader.cancel()
      throw new Error(`响应内容超过 ${maxCharacters} 字符限制`)
    }
    if (done) return content
  }
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

  const endpoint = validateHttpEndpoint(
    provider.baseUrl ||
    (provider.type === 'zhipu'
      ? 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
      : 'https://api.openai.com/v1/chat/completions'),
    'Provider',
  )

  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(60_000),
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

  const endpoint = validateHttpEndpoint(
    provider.baseUrl ||
    (provider.type === 'zhipu'
      ? 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
      : 'https://api.openai.com/v1/chat/completions'),
    'Provider',
  )
  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(60_000),
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
          if (content.length > 200_000) {
            await reader.cancel()
            throw new Error('模型流式回复超过 200000 字符限制')
          }
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

  const endpoint = validateHttpEndpoint(applyToolTemplate(tool.endpoint, input), 'Tool Endpoint')

  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(20_000),
    method: tool.method,
    headers,
    body: tool.method === 'POST' ? JSON.stringify(extractToolVariables(input)) : undefined,
  })

  const text = await readResponseTextLimited(response)

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
  return getApplicationVersion()
})

ipcMain.handle('system:get-info', () => {
  return {
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
  }
})

ipcMain.handle('ai:chat', async (_event, userText: string) => {
  const startedAt = Date.now()
  try {
    const reply = await createAiReply(userText)
    writeAuditLog({ category: 'agent', action: 'chat.complete', summary: 'AI 对话已完成', durationMs: Date.now() - startedAt, metadata: { inputLength: userText.length, outputLength: reply.content.length } })
    return reply
  } catch (error) {
    writeAuditLog({ category: 'agent', action: 'chat.complete', summary: 'AI 对话失败', detail: error, status: 'failure', durationMs: Date.now() - startedAt })
    throw error
  }
})

ipcMain.handle('ai:chat-stream', async (event, requestId: string, userText: string) => {
  const provider = getActiveProvider()
  const startedAt = Date.now()
  try {
    const reply = await requestChatCompletionStream(provider, userText, (delta) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('ai:chat-stream-delta', requestId, delta)
      }
    })
    writeAuditLog({ category: 'agent', action: 'chat.stream', summary: `流式回复完成：${provider.name}`, durationMs: Date.now() - startedAt, metadata: { providerId: provider.id, model: provider.model, inputLength: userText.length, outputLength: reply.content.length } })
    return reply
  } catch (error) {
    writeAuditLog({ category: 'agent', action: 'chat.stream', summary: `流式回复失败：${provider.name}`, detail: error, status: 'failure', durationMs: Date.now() - startedAt, metadata: { providerId: provider.id, model: provider.model } })
    throw error
  }
})

ipcMain.handle('platform:get-config', () => {
  return readPlatformConfig()
})

ipcMain.handle('platform:save-config', (_event, config: AgentPlatformConfig) => {
  const saved = savePlatformConfig(config)
  writeAuditLog({ category: 'security', action: 'config.save', summary: '模型、Skill 与 Tool 配置已保存', metadata: { activeProviderId: saved.activeProviderId, providers: saved.providers.length, skills: saved.customSkills.length, tools: saved.customTools.length } })
  return saved
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

ipcMain.handle('audit:list', (_event, filters: AuditLogFilters) => {
  return listAuditLogs(filters)
})

ipcMain.handle('audit:export', (_event, filters: AuditLogFilters) => {
  return exportAuditLogs(filters)
})

ipcMain.handle('audit:clear', () => {
  const result = initializeDatabase().prepare('DELETE FROM audit_logs').run()
  writeAuditLog({ category: 'security', action: 'audit.clear', summary: `已清理 ${result.changes} 条审计日志`, metadata: { deleted: result.changes } })
  return { deleted: Number(result.changes) }
})

ipcMain.handle('data:export', () => {
  return exportUserData()
})

ipcMain.handle('data:clear', () => {
  return clearUserData()
})

ipcMain.handle('data:open-folder', async () => {
  const dataPath = app.getPath('userData')
  await shell.openPath(dataPath)
  writeAuditLog({ category: 'system', action: 'data.open-folder', summary: '已打开本地数据目录' })
  return dataPath
})

ipcMain.handle('knowledge:sync', (_event, documents: unknown) => {
  return syncKnowledgeDocuments(documents)
})

ipcMain.handle('knowledge:list', () => {
  return listKnowledgeDocuments()
})

ipcMain.handle('knowledge:upsert', (_event, document: unknown) => {
  return upsertKnowledgeDocument(document)
})

ipcMain.handle('knowledge:search', (_event, query: string, limit?: number) => {
  const safeQuery = typeof query === 'string' ? query.slice(0, 1000) : ''
  const results = searchKnowledge(safeQuery, limit)
  writeAuditLog({ category: 'knowledge', action: 'knowledge.search', summary: `资料库检索命中 ${results.length} 个片段`, status: results.length > 0 ? 'success' : 'failure', level: results.length > 0 ? 'info' : 'warn', metadata: { queryLength: safeQuery.length, results: results.length, sources: [...new Set(results.map((item) => item.documentName))].join(', ') } })
  return results
})

ipcMain.handle('knowledge:delete', (_event, documentId: string) => {
  return deleteKnowledgeDocument(documentId)
})

ipcMain.handle('memory:list', () => {
  return readMemoryNotes()
})

ipcMain.handle('memory:sync', (_event, notes: unknown) => {
  return syncMemoryNotes(notes)
})

ipcMain.handle('memory:add', (_event, text: string, category?: string, expiresAt?: number) => {
  const notes = addMemoryNote(text, category, expiresAt)
  writeAuditLog({ category: 'workflow', action: 'memory.add', summary: '已添加长期记忆', metadata: { characters: text.length, category } })
  return notes
})

ipcMain.handle('memory:update', (_event, noteId: string, patch: unknown) => {
  const notes = updateMemoryNote(noteId, patch)
  writeAuditLog({ category: 'workflow', action: 'memory.update', summary: '已更新长期记忆', metadata: { noteId } })
  return notes
})

ipcMain.handle('memory:delete', (_event, noteId: string) => {
  const notes = deleteMemoryNote(noteId)
  writeAuditLog({ category: 'workflow', action: 'memory.delete', summary: '已删除长期记忆', metadata: { noteId } })
  return notes
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
  const saved = saveWorkspaceData(data)
  writeAuditLog({ category: 'workflow', action: 'report.save', summary: `已生成报告：${savedReport.title}`, metadata: { reportId: savedReport.id, source: savedReport.source } })
  return saved
})

ipcMain.handle('workflow:delete-report', (_event, reportId: string) => {
  const data = readWorkspaceData()
  data.reports = data.reports.filter((report) => report.id !== String(reportId))
  const saved = saveWorkspaceData(data)
  writeAuditLog({ category: 'workflow', action: 'report.delete', summary: '已删除报告', metadata: { reportId } })
  return saved
})

ipcMain.handle('workflow:save-plan', (_event, plan: Omit<ButlerPlan, 'id' | 'status' | 'checkins' | 'createdAt' | 'updatedAt'>) => {
  const data = readWorkspaceData()
  const savedPlan: ButlerPlan = {
    id: createId('plan'),
    title: plan.title,
    description: plan.description,
    status: 'active',
    checkins: 0,
    priority: ['low', 'medium', 'high'].includes(plan.priority) ? plan.priority : 'medium',
    dueDate: typeof plan.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(plan.dueDate) ? plan.dueDate : undefined,
    recurrence: ['none', 'daily', 'weekly'].includes(plan.recurrence) ? plan.recurrence : 'none',
    progress: 0,
    nextAction: typeof plan.nextAction === 'string' ? plan.nextAction.slice(0, 1000) : undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  data.plans = [savedPlan, ...data.plans]
  appendActivity(data, {
    type: 'plan',
    text: `新增计划：${savedPlan.title}`,
  })
  const saved = saveWorkspaceData(data)
  writeAuditLog({ category: 'workflow', action: 'plan.create', summary: `已创建计划：${savedPlan.title}`, metadata: { planId: savedPlan.id } })
  return saved
})

ipcMain.handle('workflow:update-plan', (_event, planId: string, patch: Partial<ButlerPlan>) => {
  const data = readWorkspaceData()
  const normalizedPatch: Partial<ButlerPlan> = {}
  if (typeof patch.title === 'string' && patch.title.trim()) normalizedPatch.title = patch.title.trim().slice(0, 300)
  if (typeof patch.description === 'string') normalizedPatch.description = patch.description.trim().slice(0, 4000)
  if (patch.status === 'active' || patch.status === 'done') {
    normalizedPatch.status = patch.status
    normalizedPatch.completedAt = patch.status === 'done' ? Date.now() : undefined
    if (patch.status === 'done') normalizedPatch.progress = 100
  }
  if (patch.priority && ['low', 'medium', 'high'].includes(patch.priority)) normalizedPatch.priority = patch.priority
  if (patch.recurrence && ['none', 'daily', 'weekly'].includes(patch.recurrence)) normalizedPatch.recurrence = patch.recurrence
  if (patch.dueDate === undefined || (typeof patch.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(patch.dueDate))) normalizedPatch.dueDate = patch.dueDate
  if (patch.reminderTime === undefined || (typeof patch.reminderTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(patch.reminderTime))) normalizedPatch.reminderTime = patch.reminderTime
  if (patch.lastReminderDate === undefined || typeof patch.lastReminderDate === 'string') normalizedPatch.lastReminderDate = patch.lastReminderDate
  if (typeof patch.progress === 'number') normalizedPatch.progress = Math.max(0, Math.min(Math.round(patch.progress), 100))
  if (patch.nextAction === undefined || typeof patch.nextAction === 'string') normalizedPatch.nextAction = patch.nextAction?.trim().slice(0, 1000)
  data.plans = data.plans.map((plan) =>
    plan.id === planId
      ? {
          ...plan,
          ...normalizedPatch,
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
  const saved = saveWorkspaceData(data)
  writeAuditLog({ category: 'workflow', action: 'plan.update', summary: `已更新计划：${saved.plans.find((plan) => plan.id === planId)?.title ?? planId}`, metadata: { planId, fields: Object.keys(normalizedPatch).join(',') } })
  return saved
})

ipcMain.handle('workflow:delete-plan', (_event, planId: string) => {
  const data = readWorkspaceData()
  const targetPlan = data.plans.find((plan) => plan.id === planId)
  data.plans = data.plans.filter((plan) => plan.id !== planId)
  appendActivity(data, {
    type: 'plan',
    text: `删除计划：${targetPlan?.title ?? planId}`,
  })
  const saved = saveWorkspaceData(data)
  writeAuditLog({ category: 'workflow', action: 'plan.delete', summary: `已删除计划：${targetPlan?.title ?? planId}`, metadata: { planId } })
  return saved
})

ipcMain.handle('workflow:checkin-plan', (_event, planId: string, note: string, progress?: number) => {
  const data = readWorkspaceData()
  data.plans = data.plans.map((plan) =>
    plan.id === planId
      ? {
          ...plan,
          checkins: plan.checkins + 1,
          progress: typeof progress === 'number' ? Math.max(plan.progress, Math.min(Math.round(progress), 100)) : plan.progress,
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
  const saved = saveWorkspaceData(data)
  writeAuditLog({ category: 'workflow', action: 'plan.checkin', summary: `已记录计划进度：${targetPlan?.title ?? planId}`, metadata: { planId, noteLength: note.length } })
  return saved
})

ipcMain.handle('workflow:add-activity', (_event, text: string) => {
  const data = readWorkspaceData()
  appendActivity(data, {
    type: 'note',
    text,
  })
  return saveWorkspaceData(data)
})

ipcMain.handle('workflow:delete-activity', (_event, activityId: string) => {
  const data = readWorkspaceData()
  data.activities = data.activities.filter((activity) => activity.id !== String(activityId))
  return saveWorkspaceData(data)
})

ipcMain.handle('workflow:notify', (_event, title: string, body: string) => {
  if (!Notification.isSupported()) {
    writeAuditLog({ level: 'warn', category: 'system', action: 'notification.show', summary: '当前系统不支持桌面通知', status: 'failure' })
    return false
  }

  new Notification({
    title,
    body,
  }).show()
  writeAuditLog({ category: 'system', action: 'notification.show', summary: `已发送提醒：${title}`, metadata: { bodyLength: body.length } })
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
  const startedAt = Date.now()
  try {
    const result = await invokeCustomTool(toolId, input)
    writeAuditLog({ category: 'tool', action: 'tool.invoke', summary: `工具调用成功：${result.name}`, durationMs: Date.now() - startedAt, metadata: { toolId, inputLength: input.length } })
    return result
  } catch (error) {
    writeAuditLog({ category: 'tool', action: 'tool.invoke', summary: `工具调用失败：${toolId}`, detail: error, status: 'failure', durationMs: Date.now() - startedAt, metadata: { toolId } })
    throw error
  }
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
    writeAuditLog({ level: 'warn', category: 'file', action: 'file.pick', summary: '用户取消选择文件', status: 'failure' })
    return null
  }

  const filePath = result.filePaths[0]
  const file = await readSupportedFile(filePath)
  writeAuditLog({ category: 'file', action: 'file.read', summary: `已读取文件：${file.name}`, metadata: { extension: path.extname(filePath), bytes: fs.statSync(filePath).size } })
  return file
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

  const paths = result.filePaths.slice(0, 10)
  const files = await Promise.all(paths.map(readSupportedFile))
  writeAuditLog({ category: 'file', action: 'file.read-many', summary: `已读取 ${files.length} 个文件`, metadata: { files: files.map((file) => file.name).join(', ') } })
  return files
})

ipcMain.handle('file:pick-directory-text', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择要读取的文件夹',
    properties: ['openDirectory'],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return []
  }

  const files = await readDirectoryTextFiles(result.filePaths[0])
  writeAuditLog({ category: 'file', action: 'directory.read', summary: `已从文件夹读取 ${files.length} 个文件`, metadata: { directory: path.basename(result.filePaths[0]), files: files.map((file) => file.name).join(', ') } })
  return files
})

ipcMain.handle('file:read-dropped', async (_event, filePath: string) => {
  if (!filePath || !fs.existsSync(filePath)) {
    writeAuditLog({ category: 'file', action: 'file.drop', summary: '拖拽文件不存在或路径无效', status: 'failure' })
    return null
  }

  const stat = fs.statSync(filePath)
  if (!stat.isFile()) {
    writeAuditLog({ category: 'file', action: 'file.drop', summary: '拖拽内容不是文件', status: 'failure' })
    return null
  }

  const extension = path.extname(filePath).toLowerCase()
  if (!supportedFileExtensions.has(extension)) {
    writeAuditLog({ level: 'warn', category: 'file', action: 'file.drop', summary: `不支持的文件格式：${extension || '未知'}`, status: 'failure', metadata: { fileName: path.basename(filePath), bytes: stat.size } })
    return {
      name: path.basename(filePath),
      path: filePath,
      content: `暂不支持直接读取 ${extension || '未知'} 格式。`,
    }
  }

  const file = await readSupportedFile(filePath)
  writeAuditLog({ category: 'file', action: 'file.drop', summary: `已读取拖拽文件：${file.name}`, metadata: { extension, bytes: stat.size } })
  return file
})

ipcMain.handle('file:read-named-text', async (_event, query: string) => {
  const filePath = findDesktopTextFile(query)

  if (!filePath) {
    writeAuditLog({ level: 'warn', category: 'file', action: 'file.find-desktop', summary: '桌面未找到匹配文件', status: 'failure', metadata: { queryLength: query.length } })
    return null
  }

  const file = await readSupportedFile(filePath)
  writeAuditLog({ category: 'file', action: 'file.find-desktop', summary: `已读取桌面文件：${file.name}`, metadata: { extension: path.extname(filePath), bytes: fs.statSync(filePath).size } })
  return file
})

ipcMain.handle('window:toggle-always-on-top', () => {
  if (!mainWindow) {
    return false
  }

  const nextValue = !mainWindow.isAlwaysOnTop()
  mainWindow.setAlwaysOnTop(nextValue)
  writeAuditLog({ category: 'system', action: 'window.always-on-top', summary: nextValue ? '已开启窗口置顶' : '已关闭窗口置顶' })
  return nextValue
})

app.whenReady().then(() => {
  initializeDatabase()
  migratePlaintextSecrets()
  writeAuditLog({
    category: 'system',
    action: 'app.start',
    summary: `应用已启动 v${getApplicationVersion()}`,
    metadata: { platform: process.platform, arch: process.arch, packaged: app.isPackaged },
  })
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
    const trayIconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(appRoot, 'build', 'icon.png')
    tray = new Tray(trayIconPath)
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
  writeAuditLog({ category: 'system', action: 'app.stop', summary: '应用正常退出' })
  globalShortcut.unregisterAll()
  database?.close()
  database = null
  tray = null
})

process.on('uncaughtException', (error) => {
  writeAuditLog({ category: 'system', action: 'process.uncaught-exception', summary: '主进程发生未捕获异常', detail: error.stack ?? error.message, status: 'failure' })
  console.error(error)
})

process.on('unhandledRejection', (reason) => {
  writeAuditLog({ category: 'system', action: 'process.unhandled-rejection', summary: '主进程发生未处理 Promise 拒绝', detail: reason, status: 'failure' })
  console.error(reason)
})
