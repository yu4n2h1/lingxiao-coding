# 进程生命周期契约

> 定义凌霄启动顺序、关闭顺序和清理优先级

## 启动顺序

```
1. installProcessRuntimeGuards()
   └── 注册 uncaughtException / unhandledRejection handler
   └── 注册 SIGINT / SIGTERM handler → gracefulShutdown()

2. loadSettings()
   └── 读取 ~/.lingxiao/config.json
   └── 合并默认值
   └── ⚠️ P0-9: 失败时应回退默认配置（当前直接抛异常）

3. DatabaseManager 初始化
   └── 打开 SQLite (WAL 模式)
   └── ensureConnection()

4. createEventEmitter() / createMessageBus()
   └── EventEmitter maxListeners = 100
   └── MessageBus 优先级队列

5. SessionManager 初始化
   └── new SessionManager(db, eventEmitter, bus)
   └── 恢复持久化的活跃会话

6. createServerWithDeps()  (server.ts)
   ├── Fastify 实例 + 插件注册
   │   ├── @fastify/cors (origin: false)
   │   ├── @fastify/websocket
   │   ├── @fastify/rate-limit (200/min/IP)
   │   └── @fastify/static (web/dist)
   │
   ├── 基础设施初始化
   │   ├── ServerAuth (token 生成)
   │   ├── ConnectionManager (MAX=100)
   │   ├── SseBridge (事件订阅 → SSE 转发)
   │   └── AcpHandler (会话消息处理)
   │
   ├── ScheduledTaskManager.start()
   │   └── 30s 轮询定时器
   │   └── ⚠️ P0-1: pollTimer 缺少 unref()
   │
   ├── ResourceBudgetService.start()
   │   └── 定期磁盘/DB 清理
   │
   ├── UpdateChecker.start()
   │   └── 延迟 10s 首次检查 + 24h 定期
   │
   ├── registerCleanup() × N
   │   └── 按优先级注册清理函数
   │
   └── register*Routes() × 22
       └── API 路由注册

7. 启动 TUI 或 WebUI
   ├── TUI: cli-tui.ts → Ink 渲染
   └── WebUI: 浏览器打开 http://localhost:<port>
```

## 关闭顺序

`gracefulShutdown()` 按优先级倒序执行 `registerCleanup` 注册的清理函数：

| 优先级 | 清理函数 | 说明 |
|--------|----------|------|
| 10 | `db.close()` | 最后关闭数据库 |
| 9.5 | `killOrphanWorkers()` | 回收孤儿 worker 进程 |
| 9.4 | `sessionManager.destroy()` | 销毁所有 session → AgentPool → WorkerRunner |
| 9 | `scheduledTaskManager.stop()` | 停止定时任务轮询 |
| 8 | `resourceBudget.stop()` | 停止磁盘清理 |
| 8 | `updateChecker.stop()` | 停止版本检查 |
| 8 | `sseBridge.stop()` | 关闭 SSE 连接和心跳 |
| 8 | `sseBridge.destroy()` | 释放 ConnectionManager |
| < 8 | 其他清理 | Fastify close, 文件句柄释放等 |

### 清理顺序设计原则

1. **先停源头，后关存储**：先停止产生事件的组件（ScheduledTaskManager、UpdateChecker），再关闭事件管道（SseBridge），最后关闭数据库
2. **先释放进程，后释放内存**：先 SIGKILL worker 子进程（9.5），再销毁内存中的 session 对象（9.4）
3. **数据库最后关闭**：确保所有写入完成后再 close DB

## 信号处理

| 信号 | 行为 |
|------|------|
| `SIGINT` (Ctrl+C) | `gracefulShutdown('SIGINT')` → 清理 → `process.exit(0)` |
| `SIGTERM` | `gracefulShutdown('SIGTERM')` → 清理 → `process.exit(0)` |
| `uncaughtException` | 记录日志 → `gracefulShutdown('uncaughtException')` → `process.exit(1)` |
| `unhandledRejection` | 记录日志 → 继续运行（不退出） |

## 定时器清单

| 定时器 | 位置 | 间隔 | unref | 清理 |
|--------|------|------|-------|------|
| ScheduledTaskManager.pollTimer | `core/ScheduledTaskManager.ts:230` | 30s | ⚠️ 缺失 (P0-1) | `stop()` clearInterval |
| SseBridge.heartbeatInterval | `web-server/SseBridge.ts` | 15s | ⚠️ 缺失 (P1-13) | `stop()` clearInterval |
| ResourceBudgetService.timer | `core/ResourceBudgetService.ts:105` | 1h | ✅ | `stop()` clearInterval |
| UpdateChecker.intervalTimer | `core/UpdateChecker.ts` | 24h | ✅ | `stop()` clearInterval |
| UpdateChecker.initialTimer | `core/UpdateChecker.ts` | 10s 一次性 | ✅ | `stop()` clearTimeout |
| LeaderProgressInvariant.watchdogTimer | `agents/LeaderAgent.ts` | 可变 | ⚠️ 缺失 (P1-7) | 需添加 |
| sseStore.streamingWatchdog | `web/src/stores/sseStore.ts:573` | 客户端 | N/A | ✅ setInterval + clearInterval |

## 进程退出保证

**当前风险：**
- pollTimer (P0-1)、heartbeatInterval (P1-13)、watchdogTimer (P1-7) 缺少 `.unref()`
- 如果 `gracefulShutdown` 中的 `stop()` 调用因异常跳过，这些定时器会阻止进程退出

**修复要求：**
- 所有长生命周期定时器必须 `.unref()`
- `registerCleanup` 中每个清理函数用 try-catch 包裹，确保一个失败不影响后续
