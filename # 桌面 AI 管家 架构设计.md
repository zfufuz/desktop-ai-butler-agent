# 桌面 AI 管家 架构设计

## 技术栈

- Electron
- React
- TypeScript
- Node.js
- Zustand
- electron-store
- exceljs
- diff

## 模块划分

- Desktop UI：聊天窗口、Live2D、设置页、日志页
- Agent Core：对话、工具调用、任务规划
- Tool Registry：统一管理文件、代码、表格、提醒工具
- Permission System：处理删除、覆盖、代码修改等高风险操作
- Logger：记录聊天、工具调用、文件改动、错误
- Voice：TTS 播放和音色配置
- Live2D：立绘加载、状态切换


cd C:\Users\11965\OneDrive\桌面\实习\agent9999\apps\desktop

npm run dev