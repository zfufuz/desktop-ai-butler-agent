# 桌面 AI 管家

一个基于 Electron、React 和 TypeScript 的 Windows 桌面 Agent。它把大模型回答、本地文件分析、报告、计划、提醒、Skill、HTTP Tool 和长期工作记录连接成持续行动闭环。

## 项目结构

```text
apps/
  desktop-full/  完整功能版，也是当前主要交付版本
```

## 当前能力

- OpenAI-compatible 与智谱模型 Provider，可切换模型和接口。
- 真实 SSE 流式聊天，支持多轮 Agent Orchestrator。
- 统一 Tool Schema、权限确认、工具观察和运行记录。
- 本地文件选择与拖拽，支持文本、代码、CSV、Excel、Word、PPT、PDF 等常见格式。
- 文件分析后生成报告、计划、今日任务、进度复盘和桌面悬浮报告。
- 内置与自定义 Prompt Skill、HTTP API Tool、扩展目录自动扫描。
- 本地知识库检索、长期记忆、出差规划和桌面提醒。
- SQLite 持久化、FTS5 分段检索、来源片段预览和 Agent 运行历史。
- SQLite 审计日志中心，按级别、类别、状态和关键词筛选，支持脱敏导出。
- Agent 运行检查点、中断恢复、严格 Tool Schema 校验和低风险只读工具重试。
- 计划优先级、截止日期、重复周期、完成度、下一步、逾期提醒和 AI 复盘。
- 长期记忆分类、置顶、编辑、有效期，以及不含密钥的本地数据备份。
- Provider 与 Tool API Key 使用 Electron `safeStorage` 加密保存。

## 本地运行

```bash
cd apps/desktop-full
npm install
npm run dev:electron
```

只验证构建：

```bash
npm run lint
npm test
npm run build
npm run build:electron
```

生成 Windows 安装包：

```bash
npm run package:win
```

安装器输出到 `apps/desktop-full/artifacts/`。

## 模型配置

复制 `apps/desktop-full/.env.example` 为 `.env.local`，或者在应用开发者设置中添加 Provider。不要提交 `.env.local` 或真实 API Key。

```env
VITE_AI_PROVIDER=zhipu
ZHIPU_API_KEY=replace_with_your_key
ZHIPU_MODEL=glm-4-flash
```

## 安全边界

- React 渲染进程不能直接访问 Node.js，通过 preload 白名单调用 Electron 主进程。
- 本地文件和外部 API Tool 需要显式权限确认。
- API Key 在用户配置中使用系统安全存储加密。
- 网络 Tool 仅允许 HTTP/HTTPS，限制响应大小，并设置 20 秒超时；模型请求设置 60 秒超时。
- 审计日志不会保存文件正文、对话正文或 API Key，导出的完整备份同样排除密钥。
- 仓库不包含真实密钥、用户数据、Agent 运行记录和本机构建产物。

详细功能和扩展格式见 [完整版本说明](apps/desktop-full/README.md)。
