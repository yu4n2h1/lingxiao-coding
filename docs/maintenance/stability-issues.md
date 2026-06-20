# 稳定性问题清单

> 5 Agent 并行审计发现的全量问题，按层分类，含修复优先级和代码位置

## P0 — 必须立即修复（10 个）

### P0-1: ScheduledTaskManager pollTimer 缺少 unref
- **层**: 核心引擎
- **文件**: `src/core/ScheduledTaskManager.ts:230`
- **影响**: 进程无法正常退出，Ctrl+C 后挂起
- **修复**: `this.pollTimer = setInterval(...); this.pollTimer.unref();`

### P0-2: MessageBus.unregister 全局 0 调用方
- **层**: 核心引擎
- **文件**: `src/core/MessageBus.ts:285-290`
- **影响**: 订阅只增不减，长生命周期 session 内存泄漏
- **修复**: 在 SessionManager.destroy() 中遍历所有 handlerId 调用 unregister

### P0-3: LeaderAgent.ts 3500+ 行巨型文件
- **层**: Agent 系统
- **文件**: `src/agents/LeaderAgent.ts`
- **影响**: 维护困难、合并冲突高发、难以测试
- **修复**: 拆分为 LeaderDecisionEngine + LeaderToolExecutor + LeaderStateManager（见 mega-file-refactoring.md）

### P0-4: LeaderProgressInvariant watchdogTimer 缺少 unref
- **层**: Agent 系统
- **文件**: `src/agents/LeaderAgent.ts` (watchdogTimer)
- **影响**: Leader 看门狗定时器阻止进程退出
- **修复**: 创建后立即 `.unref()`

### P0-5: GitIntegrationApi 路径遍历漏洞
- **层**: Web 服务器
- **文件**: `src/web-server/GitIntegrationApi.ts:29-31`
- **影响**: `resolveReadWorkspace` / `resolveWriteWorkspace` 无路径校验，可读取任意文件
- **修复**: 添加 `isPathInside(target, root)` 校验（见 security-hardening.md）

### P0-6: window.__LINGXIAO_TOKEN__ XSS 攻击链
- **层**: Web 服务器 + 前端
- **文件**: `src/server.ts:326-337` (注入) + `web/src/components/chat/McpAppRenderer.tsx:114,190-219` (postMessage targetOrigin='*')
- **影响**: 恶意内容可通过 postMessage 获取 token，形成完整 XSS 链
- **修复**: 改用 HttpOnly cookie 传递 token + postMessage 限定 targetOrigin（见 security-hardening.md）

### P0-7: sseStore.ts 1400+ 行巨型文件
- **层**: 前端
- **文件**: `web/src/stores/sseStore.ts`
- **影响**: SSE 事件分发逻辑集中，维护困难
- **修复**: 按事件类型拆分为 sessionHandlers / agentHandlers / leaderHandlers / orchestrationHandlers（见 mega-file-refactoring.md）

### P0-8: LingXiaoTUI.tsx 2800+ 行巨型文件
- **层**: 前端
- **文件**: `src/tui/LingXiaoTUI.tsx`
- **影响**: 40+ useState，渲染逻辑臃肿，TUI 性能下降
- **修复**: 拆分为独立功能组件（见 mega-file-refactoring.md）

### P0-9: 配置文件损坏无恢复机制
- **层**: CLI
- **文件**: `src/config.ts:1307-1347`
- **影响**: config.json 解析失败时直接抛异常，用户无法启动
- **修复**: catch JSON.parse → 备份损坏文件 → 回退默认配置 → 提示用户

### P0-10: 升级中断无回滚机制
- **层**: CLI
- **文件**: `src/cli_upgrade.ts:200-272`
- **影响**: 下载解压中断后安装目录不一致，无法回滚
- **修复**: 下载到临时目录 → 验证完整性 → 原子 rename → 旧版本备份到 .bak

## P1 — 下一版本修复（28 个）

### 核心引擎（6 个）

| # | 问题 | 文件 | 修复 |
|---|------|------|------|
| P1-1 | FileSink 同步写入阻塞事件循环 | `src/core/Log.ts:59-91` | 改用 async writeFileSync 或写入队列 |
| P1-2 | DatabaseManager ensureConnection 无退避 | `src/core/Database.ts:864-877` | 指数退避重试 |
| P1-3 | WorkerProcessRunner destroy 超时 5s 不可配置 | `src/core/WorkerProcessRunner.ts:903-943` | 参数化超时 |
| P1-4 | gracefulShutdown cleanup 异常处理不完整 | `src/core/RuntimeGuards.ts:87-164` | 每个 cleanup try-catch 包裹 |
| P1-5 | SessionManager 无 schema version 迁移 | `src/runtime/SessionManagerRuntime.ts:274-310` | 检查 schema version → 执行迁移 |
| P1-6 | Log 文件轮转无文件锁 | `src/core/Log.ts:59-91` | 多进程并发写入需文件锁 |

### Agent 系统（5 个）

| # | 问题 | 文件 | 修复 |
|---|------|------|------|
| P1-7 | 46 处 `catch { /* tolerate */ }` 无日志 | `src/agents/` (46 matches) | 业务路径 catch 添加日志或错误传播 |
| P1-8 | FaultRecovery respawn 限制硬编码 | `src/agents/pool/FaultRecovery.ts:109-400` | 参数配置化 |
| P1-9 | ToolLoopDetector 无跨 session 隔离 | `src/agents/runtime/ToolLoopDetector.ts:1-111` | 按 sessionId 分区检测 |
| P1-10 | LlmGuard 规则不可配置 | `src/agents/LlmGuard.ts:1-700` | 规则外部化为 JSON/YAML |
| P1-11 | LeaderTools 无全局超时策略 | `src/agents/LeaderTools.ts` | 工具分类设置默认超时 |

### Web 服务器（5 个）

| # | 问题 | 文件 | 修复 |
|---|------|------|------|
| P1-12 | TempDownloadRoutes 无认证 | `src/web-server/TempDownloadRoutes.ts:4-13` | 添加 requireServerToken |
| P1-13 | SseBridge heartbeatInterval 缺 unref | `src/web-server/SseBridge.ts` | `.unref()` |
| P1-14 | GitIntegrationApi/BrowserRoutes URL 参数无 SSRF 防护 | `src/web-server/GitIntegrationApi.ts` | 添加 isInternalUrl 过滤 |
| P1-15 | 错误响应格式不统一 | `src/web-server/` (多文件) | 统一 `reply.code(N).send({ error: msg })` |
| P1-16 | 认证未使用 Fastify preHandler 中间件 | `src/web-server/` (多文件) | 迁移为 preHandler 模式 |

### 前端（5 个）

| # | 问题 | 文件 | 修复 |
|---|------|------|------|
| P1-17 | SSE 重连竞态 | `web/src/api/AcpClient.ts:64-74,116-138` | 新 connectionId + 丢弃旧连接事件 |
| P1-18 | streamingTimer 清理不完整 | `web/src/stores/sseStore.ts` | cleanup 中 clearTimeout |
| P1-19 | McpAppRenderer postMessage targetOrigin='*' | `web/src/components/chat/McpAppRenderer.tsx:114,190-219` | 限定为已知 origin |
| P1-20 | i18n 翻译不完整 | `web/src/` + `src/tui/` | 补全缺失翻译 key |
| P1-21 | useTuiEventBridge 依赖数组过长 | `src/tui/runtime/useTuiEventBridge.ts:369` | 拆分 useEffect 或用 ref |

### CLI/工程化（7 个）

| # | 问题 | 文件 | 修复 |
|---|------|------|------|
| P1-22 | fetchLatestRelease 依赖 curl 子进程 | `src/cli_upgrade.ts:72-93` | 改用 native fetch |
| P1-23 | refreshSymlink 硬编码 /usr/local/bin | `src/cli_upgrade.ts` | 动态解析 bin 目录 |
| P1-24 | 无 config schema version 迁移 | `src/config.ts` | 检查 version → 执行迁移函数 |
| P1-25 | 构建脚本网络依赖不可选 | `scripts/build.mjs` | 离线构建模式 |
| P1-26 | postinstall 脚本无错误恢复 | `scripts/postinstall.mjs` | 捕获异常 → 降级处理 |
| P1-27 | bump-version 无 pre-release 支持 | `scripts/bump-version.mjs` | 支持 --pre flag |
| P1-28 | tsconfig 路径别名不完全一致 | `tsconfig.*.json` | 统一路径映射 |

## P2 — 排期处理（32 个）

### 核心引擎（8 个）

| # | 问题 | 修复建议 |
|---|------|----------|
| P2-1 | DatabaseManager 无连接池 | better-sqlite3 同步 API，单连接可接受；如需并发考虑 worker_threads |
| P2-2 | MessageBus 无消息持久化 | 可选持久化到 DB 用于崩溃恢复 |
| P2-3 | EventEmitter 无事件溯源 | 可选 EventStore 用于调试 |
| P2-4 | ScheduledTaskManager 无分布式锁 | 单进程场景不需要；多进程时需引入 |
| P2-5 | ResourceBudgetService 清理策略不可配置 | 外部化为配置项 |
| P2-6 | Log 无结构化日志 | 引入 JSON 格式日志 |
| P2-7 | WorkerProcessRunner 无资源限制 | 添加 worker 内存/CPU 限制 |
| P2-8 | RuntimeGuards 无关闭超时 | 添加 10s 硬超时后 force exit |

### Agent 系统（6 个）

| # | 问题 | 修复建议 |
|---|------|----------|
| P2-9 | AgentPoolRuntime 无动态扩缩容 | 根据负载动态调整池大小 |
| P2-10 | BaseAgentRuntime 无健康检查 | 定期 heartbeat + 响应超时检测 |
| P2-11 | LeaderSupervisionCoordinator 无优先级调度 | 按 task priority 排序监督 |
| P2-12 | ToolLoopDetector 无 ML 检测 | 当前规则检测可接受；未来可引入 |
| P2-13 | ReasoningLoopDriver 无步数限制 | 添加 maxSteps 配置 |
| P2-14 | FaultRecovery 无崩溃报告 | 记录崩溃上下文到 DB |

### Web 服务器（4 个）

| # | 问题 | 修复建议 |
|---|------|----------|
| P2-15 | 速率限制不可配置 | 外部化 rate/max 配置项 |
| P2-16 | CORS 策略不可配置 | 支持 allowed origins 配置 |
| P2-17 | 无 API 版本管理 | 添加 /api/v1/ 前缀 |
| P2-18 | 无 OpenAPI/Swagger 文档 | 自动生成 API 文档 |

### 前端（6 个）

| # | 问题 | 修复建议 |
|---|------|----------|
| P2-19 | sseStore handleSessionUpdate 分拆为 Part1-4 仍在单文件 | 随 P0-7 一起拆分 |
| P2-20 | LingXiaoTUI 40+ useState | 随 P0-8 一起拆分为独立组件 |
| P2-21 | sessionStore reactive prune 周期可调 | 外部化间隔配置 |
| P2-22 | AcpClient 无连接质量统计 | 添加 RTT/丢包率监控 |
| P2-23 | 无前端错误上报 | Sentry 或自建上报 |
| P2-24 | 组件懒加载不完整 | 路由级 code splitting |

### CLI/工程化（8 个）

| # | 问题 | 修复建议 |
|---|------|----------|
| P2-25 | package.json 无 engines warning | 添加 engineStrict |
| P2-26 | .gitignore 无 IDE 通用忽略 | 补充 .vscode/ .idea/ |
| P2-27 | 构建脚本无 source map 验证 | 添加 sourcemap 检查步骤 |
| P2-28 | 无自动化测试 CI | GitHub Actions CI |
| P2-29 | 无代码覆盖率报告 | c8 或 istanbul |
| P2-30 | 无依赖审计 | npm audit + dependabot |
| P2-31 | 无 changelog 自动生成 | conventional-changelog |
| P2-32 | 无 Docker 发布 | Dockerfile + CI 发布 |
