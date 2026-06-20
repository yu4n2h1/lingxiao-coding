# 系统分层架构

## 架构总览

```
┌──────────────────────────────────────────────────────────┐
│                      用户入口层                            │
│  cli.ts (CLI) ── cli-tui.ts (TUI) ── cli-daemon.ts        │
│  cli_upgrade.ts (升级) · config.ts (配置) · version.ts    │
└─────────────────────────┬────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────┐
│                  Web 服务器层 (Fastify)                    │
│  SseBridge · ConnectionManager · ServerAuth               │
│  AcpRoutes · FileSystemRoutes · GitIntegrationApi         │
│  TerminalRoutes · DaemonRoutes · SettingsRoutes           │
│  TempDownloadRoutes · ArtifactPreviewRoutes · WikiApi     │
│  LocalLlmGatewayRoutes · StatsRoutes · WorkflowRoutes     │
└─────────────────────────┬────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────┐
│                    Agent 编排层                            │
│  LeaderAgent · LeaderTools · LeaderSupervisionCoordinator │
│  BaseAgentRuntime · AgentPoolRuntime · FaultRecovery      │
│  WorkerProcessRunner · LlmGuard · ToolLoopDetector        │
│  ReasoningLoopDriver · RuntimeGuards                      │
└─────────────────────────┬────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────┐
│                      核心引擎层                            │
│  EventEmitter · MessageBus · DatabaseManager              │
│  SessionManager · ScheduledTaskManager                    │
│  ResourceBudgetService · Log · UpdateChecker              │
└──────────────────────────────────────────────────────────┘
```

## 层间依赖规则

| 规则 | 说明 |
|------|------|
| 上行依赖 | 上层可依赖下层接口，下层不可反向依赖上层 |
| 同层通信 | 同层模块间通过 `EventEmitter` / `MessageBus` 解耦 |
| 跨层通信 | 只允许通过本目录定义的接口契约 |
| 禁止循环 | 层间依赖必须是有向无环图 (DAG) |

## 数据流总览

```
用户输入
  │
  ▼
CLI 入口 (cli.ts)
  │
  ▼
Web 服务器 (server.ts) ──SSE──→ 前端 (WebUI/TUI)
  │                                 ▲
  ▼                                 │
LeaderAgent (决策 + DAG)            │
  │                                 │
  ▼                                 │
AgentPool → WorkerProcessRunner     │
  │                                 │
  ▼                                 │
EventEmitter ──事件──→ SseBridge ───┘
  │
  ▼
DatabaseManager (SQLite WAL)
```

## 模块规模概览

| 层 | 文件数 | 核心模块数 | 最大文件 | 行数 |
|----|--------|-----------|----------|------|
| 核心引擎 | 10+ | 9 | SessionManagerRuntime.ts | 2530 |
| Agent 编排 | 115 | 38 | LeaderAgent.ts | 3500+ |
| Web 服务器 | 42 | 15 | SseBridge.ts | 550+ |
| 前端 (WebUI) | 30+ | 10 | sseStore.ts | 1400+ |
| 前端 (TUI) | 20+ | 8 | LingXiaoTUI.tsx | 2800+ |
| CLI/工程化 | 15+ | 6 | cli.ts | 1703 |
