# 桌面 AI 管家

一个连接本地文件、桌面工具和大模型的个人工作流 Agent。

项目使用 Electron + React + TypeScript 构建桌面应用。主界面面向普通用户完成资料整理、文件分析、报告与计划闭环；模型 Provider、Prompt Skill、HTTP API Tool、RAG 和 Agent 观测能力统一放在设置与高级设置中，不再维护两套产品界面。

## 产品结构

### 日常工作台

- 读取本地 txt、md、json、log、csv、xlsx、docx、pptx、pdf、图片元信息和常见代码文件
- 分析文件内容、提取重点、给出结论
- 导入资料库，基于本地资料问答
- 生成报告、计划、待办清单
- 保存个人偏好和长期目标

### 高级设置

- 切换或添加模型 Provider
- 支持智谱、Mock、OpenAI Compatible 接口
- 安装自定义 Prompt Skill
- 安装自定义 HTTP API Tool
- API Tool 自动调用：根据用户问题和 Tool 描述自动选择工具
- 查看 Agent Timeline 和工具调用日志
- 查看可筛选、可导出的 SQLite 审计日志
- 展示 Tool Registry、Skill Registry、RAG、IPC 安全桥等工程能力

## 核心能力

- Electron 主进程托管 API Key 和本地工具能力
- React 渲染层通过 preload + IPC 调用白名单 API
- Agent Loop：目标理解、工具规划、工具调用、观察结果、最终回复
- 本地文件读取与总结
- 混合 RAG 本地资料库：智能切块、SQLite FTS5/BM25、Embedding 向量、混合评分、本地重排、上下文压缩与来源引用
- Skill Registry：项目讲解、开发日报、排错清单、README 生成
- 用户安装 Prompt Skill 与 HTTP API Tool
- 工具调用权限确认与日志可观测
- Agent 运行检查点、暂停、继续、取消、Tool Schema 严格校验和低风险重试
- 文件与 RAG 内容使用不可信数据边界，降低文档内提示词注入风险
- 分析完成后由用户选择下载、仅保存报告或保存并创建计划
- 70 条 Agent Eval 题库；其中 15 条 RAG 检索题可真实运行并统计 Recall@5、MRR、NDCG@5
- HTTP Tool 支持 JSON Schema 输入、Query/Path/Body/Header 映射、API Key 多位置鉴权、响应路径提取、重试与熔断
- 本地扩展目录自动加载：把 Skill / Tool 配置文件放入扩展文件夹后自动读取
- Windows 系统 TTS 中文语音朗读、状态动态立绘、窗口置顶、全局快捷键
- 计划截止日期、优先级、完成度、重复提醒、下一步和逾期处理
- 长期记忆分类、置顶、编辑、有效期和自动过期清理
- 本地数据备份导出、数据目录查看和工作数据清理

## 架构

```txt
React Renderer
  -> 日常工作流 / 高级设置
  -> Skill Registry
  -> Agent Service
  -> Tool Registry
  -> Preload API
  -> IPC
  -> Electron Main Process
  -> Desktop Tools / Model Provider / File System
```

## 安全设计

- API Key 由 Electron 主进程读取和保存
- React 页面不直接访问 Node.js 或本地文件系统
- 文件读取通过 Electron 文件选择器完成
- 自定义 HTTP Tool 调用前需要用户确认
- HTTP Tool 仅允许 HTTP/HTTPS，限制响应体大小，并使用 20 秒超时
- 审计日志自动限制保留 5000 条，敏感字段脱敏，不记录文件和对话正文
- 数据备份不包含 Provider 或 Tool API Key
- 第一版不直接执行用户安装的任意代码，后续可通过沙箱插件系统扩展

## 运行

```bash
npm install
npm run dev:electron
```

质量检查与 Windows 打包：

```bash
npm run lint
npm test
npm run build
npm run build:electron
npm run package:win
```

安装器输出到 `artifacts/`。用户资料、计划、报告、知识库索引和 Agent 运行记录保存在 Electron 用户数据目录，不会写入安装目录。

## 审计日志与数据管理

管家工作台中的“审计日志”会记录 Agent、Tool、文件、知识库、工作流、安全配置和主进程异常。可以按级别、类别、状态或关键词筛选，并导出为 JSON。

设置中的“数据与隐私”可以导出本地完整备份、打开 Electron 用户数据目录，或清理报告、计划、行动、记忆、知识库和 Agent 历史。模型 Provider、Skill 与 Tool 配置会保留。

## 当前外部依赖

- 高德天气和驾车路线需要在“设置 → 外部服务”配置 Web 服务 Key；火车、飞机和酒店价格仍需要后续接入相应业务 Tool。
- Windows 代码签名需要有效证书；未签名安装包可能显示 SmartScreen 提示。
- 自动更新需要发布服务器或 GitHub Release 更新源，当前版本采用手动安装升级。

浏览器里的 `localhost:5173` 只能预览 UI；文件读取、桌面工具和 AI 主进程调用需要使用 Electron 窗口。

## 配置

可以在 `.env.local` 放默认智谱配置：

```env
VITE_AI_PROVIDER=zhipu
VITE_AI_MODEL=glm-4-flash
ZHIPU_MODEL=glm-4-flash
ZHIPU_API_KEY=你的智谱APIKey
```

也可以在“设置 → 高级设置”中添加新的模型 Provider、Prompt Skill 和 HTTP API Tool。

### 混合 RAG

未配置 Embedding 时，资料库使用本地 SQLite FTS5 + BM25 检索。进入“设置 → RAG 检索引擎”后，可以选择一个已配置 API Key 的 Provider，填写兼容 OpenAI `/embeddings` 结构的完整接口地址和模型名称，然后重建向量索引。

向量使用 Float32 BLOB 保存在本地 SQLite。查询时系统并行执行 BM25 与余弦相似度检索，合并候选片段后进行混合评分、本地重排和句子级上下文压缩，默认只把前 5 个带来源片段交给大模型。Embedding 请求失败时会自动降级为 BM25，不影响原有知识库。

## 本地扩展目录

应用会在 Electron `userData` 下创建扩展目录：

```txt
extensions/
  skills/
    my-skill.json
    writing-skill.md
  tools/
    weather-tool.json
```

在设置中点击“扩展文件夹”可以直接打开目录。把扩展文件放进去后，进入“已安装管理”点击“重新扫描”即可加载。

Skill JSON 示例：

```json
{
  "name": "资料分析",
  "description": "把资料整理成摘要、结论和建议",
  "prompt": "你是资料分析助手，请按摘要、结论、建议输出。"
}
```

Tool 示例：

```json
{
  "name": "天气查询",
  "description": "当用户询问某个城市今天、明天或未来几天的天气时调用",
  "method": "GET",
  "endpoint": "https://api.example.com/weather?city={{city}}",
  "apiKey": ""
}
```

## 简历描述

实现了一个面向个人办公的本地桌面工作流 Agent，将文件分析结果转化为可下载报告、计划、提醒和持续复盘；支持 Provider 配置、Prompt Skill、HTTP Tool、混合 RAG、权限确认、checkpoint 恢复、SQLite 审计日志和可运行检索评测，展示桌面端 Agent 从工具调用到持续行动闭环的工程实现。

## 当前边界

- XLSX 使用 SheetJS、DOCX 使用 Mammoth、文本型 PDF 使用 PDF.js 体系解析；PPTX 使用本地 XML 提取。扫描 PDF 与图片正文尚未接入 OCR。
- 自定义 HTTP Tool 已支持结构化 Schema 和常见请求映射；OAuth2 与 MCP Server 仍需后续接入。
- 当前动态立绘是状态驱动的桌面角色动画，不是 Live2D 模型；接入 Live2D 仍需要用户提供合法模型素材与运行时。
- 暂停和取消在 Agent 的安全步骤边界生效，不能中断已经发出的单次模型网络请求。
- RAG Eval 当前真实运行检索层；Tool 选择、权限恢复和计划复盘题保留在题库中，但不会展示未实际执行的成绩。

## GitHub 与密钥安全

不要提交 `.env.local`、真实 API Key、日志、`node_modules`、`dist` 或 `dist-electron`。仓库提供 `.env.example` 作为配置模板。通过应用设置保存的 Provider 和 HTTP Tool API Key 会由 Electron `safeStorage` 使用 Windows 用户凭据加密后写入用户数据目录。
