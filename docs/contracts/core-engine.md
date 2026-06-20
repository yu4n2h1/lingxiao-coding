# 核心引擎层契约

> 范围：`src/core/` + `src/runtime/SessionManagerRuntime.ts`

## 模块清单

| 模块 | 文件 | 职责 |
|------|------|------|
| EventEmitter | `src/core/EventEmitter.ts` | 类型安全事件发射器（非 Node.js 原生） |
| MessageBus | `src/core/MessageBus.ts` | 优先级消息队列 |
| DatabaseManager | `src/core/Database.ts` | SQLite (better-sqlite3) 管理 |
| SessionManager | `src/runtime/SessionManagerRuntime.ts` | 会话生命周期管理 |
| ScheduledTaskManager | `src/core/ScheduledTaskManager.ts` | cron 定时任务调度 |
| WorkerProcessRunner | `src/core/WorkerProcessRunner.ts` | Worker 子进程管理 |
| ResourceBudgetService | `src/core/ResourceBudgetService.ts` | 磁盘/DB 定期清理 |
| Log | `src/core/Log.ts` | 分级日志 + 文件轮转 |
| RuntimeGuards | `src/core/RuntimeGuards.ts` | 进程级异常防护 + 优雅关闭 |
| UpdateChecker | `src/core/UpdateChecker.ts` | 启动后版本更新检查 |

## EventEmitter

```typescript
class EventEmitter {
  // 订阅事件，返回 unsubscribe 函数
  subscribe<T>(event: string, handler: (data: T) => void): () => void;
  // 发射事件
  emit(event: string, data: unknown): void;
  // 订阅一次
  once(event: string, handler: (data: unknown) => void): void;
  // 移除监听
  removeAllListeners(event?: string): void;
}
```

**契约规则：**
- `subscribe()` 返回的 unsubscribe 函数**必须**在模块销毁时调用
- 事件名格式：`namespace:action`（如 `session:created`、`task:updated`）
- maxListeners = 100，超出时打印警告但不阻止
- 底层封装 Node.js EventEmitter，设置 maxListeners=100

## MessageBus

```typescript
class MessageBus {
  register(handler: MessageHandler): string;      // 返回 handlerId
  unregister(handlerId: string): void;             // ⚠️ P1-1: 当前全局无调用方
  send(message: BusMessage): void;                  // 同步入队，异步执行
  getQueueLength(): number;
}

interface BusMessage {
  id: string;
  type: string;
  payload: unknown;
  priority: 'critical' | 'important' | 'normal' | 'low';
  sessionId?: string;
  timestamp: number;
}
```

**契约规则：**
- 消息按优先级排序：`critical > important > normal > low`
- `send()` 同步入队，handler 异步执行
- `unregister()` 必须在 SessionManager.destroy() 中调用（⚠️ 当前缺失）

## DatabaseManager

```typescript
class DatabaseManager {
  getDb(): Database;                    // better-sqlite3 实例
  getPath(): string;
  ensureConnection(): void;             // 自动重连
  close(): void;
  pruneOldRecords(maxAgeHours: number): number;  // 返回删除行数
  setSessionState(sessionId: string, key: string, value: unknown): void;
  getSessionState(sessionId: string, key: string): unknown;
}
```

**契约规则：**
- SQLite WAL 模式，单进程读写
- `setSessionState` value 支持 JSON 可序列化对象
- `pruneOldRecords` 不触碰 `leader_conversation` / `agent_conversation` 表
- `ensureConnection` 自动重连（⚠️ P1-3: 无退避策略）
- WAL checkpoint 由 ResourceBudgetService 定期触发

## SessionManager

```typescript
class SessionManager {
  createSession(options: SessionOptions): Session;
  getSession(sessionId: string): Session | undefined;
  getActiveSessionIds(): string[];
  destroySession(sessionId: string): void;
  destroy(): void;                      // 销毁所有 session
  setScheduledTaskManager(mgr: ScheduledTaskManager): void;
  getWorkflowEngine(): WorkflowEngine;
  getSessionWorkflowEngine(sessionId: string): WorkflowEngine;
}
```

**契约规则：**
- 单进程内可有多个 session，但只有 active session 接收用户输入
- `destroy()` 释放顺序：AgentPool → WorkerRunner → DB 连接
- 会话恢复时检查 schema version（⚠️ P1-6: 当前未实现）
- ActiveSessionCoordinator 管理当前 active session ID

## ScheduledTaskManager

```typescript
class ScheduledTaskManager {
  start(): void;                        // 30s 轮询
  stop(): void;
  createTask(params: ScheduledTaskCreateParams): ScheduledTaskCreateResult;
  updateTask(id: string, updates: Partial<ScheduledTaskRecord>): void;
  deleteTask(id: string): void;
  fireTaskManually(id: string): void;
}
```

**契约规则：**
- cron 表达式解析为下次执行时间，30s 检查一次到期
- 系统任务前缀：`[SYSTEM:patrol]`、`[SYSTEM:dead_end_check]`、`[SYSTEM:rebalance]`、`[SYSTEM:idle_scan]`
- `firingTasks` Set 防止同 taskId 并发触发（去重窗口）
- pollTimer ⚠️ 缺少 `.unref()`（P0-1）

## WorkerProcessRunner

```typescript
class WorkerProcessRunner {
  spawn(options: WorkerSpawnOptions): string;   // 返回 workerId
  send(workerId: string, message: unknown): void;
  kill(workerId: string): void;
  destroy(): void;                              // SIGKILL 所有子进程
}
```

**契约规则：**
- Worker 是独立子进程，通过 IPC 通信
- `destroy()` 顺序：SIGTERM → 等 5s → SIGKILL → 清理 IPC 队列 → removeAllListeners
- PidRegistry 持久化跟踪 PID，防止孤儿进程
- destroy 超时 5s 不可配置（⚠️ P1-5）

## ResourceBudgetService

```typescript
class ResourceBudgetService {
  start(): void;                        // 启动定期清理
  stop(): void;
}
```

**契约规则：**
- 定期统计 `.lingxiao/sessions/`、`logs/` 磁盘占用
- 清理 terminal/scratchpad 临时数据
- 触发 SQLite WAL checkpoint：`PRAGMA wal_checkpoint(TRUNCATE)`
- 修剪高写入 DB 表：`agent_logs`、`token_usage`、`messages`、`llm_gateway_requests`、`execution_trace_events`
- 不触碰会话 resume 源和会话产物

## Log

```typescript
// 使用方式
import { coreLogger } from './core/Log.js';
coreLogger.info('消息');
coreLogger.warn('警告');
coreLogger.error('错误');
coreLogger.debug('调试');
```

**契约规则：**
- 输出到 `~/.lingxiao/logs/lingxiao-{date}.log`
- FileSink 同步写入（⚠️ P1-2: 阻塞事件循环）
- 按大小轮转

## RuntimeGuards

```typescript
function installProcessRuntimeGuards(): void;
function registerCleanup(fn: () => void, priority: number): void;
function gracefulShutdown(signal?: string): void;
```

**契约规则：**
- 注册 `uncaughtException` / `SIGINT` / `SIGTERM` handler
- `registerCleanup` 优先级：数字越大越先执行
- 清理顺序见 `process-lifecycle.md`

## UpdateChecker

```typescript
class UpdateChecker {
  start(): void;                        // 延迟 10s 首次检查 + 24h 定期检查
  stop(): void;
}
```

**契约规则：**
- 使用 native `fetch`（非 spawnSync curl），不阻塞启动
- 发现新版本时 emit `notification:new` 事件
- 同版本不重复通知（进程生命周期内去重）
- 网络异常静默跳过
