# Agent 编排层契约

> 范围：`src/agents/`

## 模块清单

| 模块 | 文件 | 职责 |
|------|------|------|
| LeaderAgent | `src/agents/LeaderAgent.ts` | 主控大脑：决策、拆任务、建 DAG、调度 |
| LeaderTools | `src/agents/LeaderTools.ts` | Leader 工具注册（80+ 工具） |
| BaseAgentRuntime | `src/agents/BaseAgentRuntime.ts` | Worker Agent 基类 |
| AgentPoolRuntime | `src/agents/AgentPoolRuntime.ts` | Agent 池管理 |
| LeaderSupervisionCoordinator | `src/agents/LeaderSupervisionCoordinator.ts` | 监督协调 |
| FaultRecovery | `src/agents/pool/FaultRecovery.ts` | 故障恢复 |
| LlmGuard | `src/agents/LlmGuard.ts` | LLM 安全防护 |
| ToolLoopDetector | `src/agents/runtime/ToolLoopDetector.ts` | 工具循环检测 |
| ReasoningLoopDriver | `src/agents/runtime/ReasoningLoopDriver.ts` | 推理循环驱动 |

## LeaderAgent

```typescript
class LeaderAgent {
  sessionId: string;
  emitter: EventEmitter;
  db: DatabaseManager;

  // 处理用户输入 → 决策 → 拆任务 → 派发
  processUserInput(input: string): Promise<void>;
  
  // 任务管理
  dispatchTask(taskId: string, agentName: string): Promise<void>;
  forceCompleteTask(taskId: string, reason: string): void;
  
  // 用户交互状态
  markWaitingForUser(waiting: boolean): void;
  markPendingUserInput(question: string): void;
  
  // 生命周期
  isRunning(): boolean;
  stop(): void;
}
```

**契约规则：**
- Leader 是单例 per session，管理该 session 的全部 Agent 和任务
- 用户输入通过 `processUserInput` 进入，Leader 决策后拆分任务 DAG
- `markWaitingForUser(true)` 后 Leader 暂停处理，等待 `user:input_needed` 闭环
- Leader 通过 EventEmitter 发射事件给 SseBridge → 前端
- ⚠️ P0-3: 3500+ 行巨型文件，需拆分为 LeaderDecisionEngine + LeaderToolExecutor + LeaderStateManager

## LeaderTools

```typescript
// 工具定义契约
interface ToolDefinition {
  name: string;                        // 工具唯一名称
  description: string;                 // LLM 可读描述
  parameters: JSONSchema;              // JSON Schema 描述参数
  execute: (args: unknown, context: ToolContext) => Promise<ToolResult>;
}

interface ToolContext {
  sessionId: string;
  leader: LeaderAgent;
  db: DatabaseManager;
  emitter: EventEmitter;
  timeout?: number;                    // ⚠️ P1-11: 无全局策略
}

interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}
```

**契约规则：**
- 80+ 内置工具，每个工具必须定义 JSON Schema 参数
- 工具执行返回 `ToolResult`
- 工具执行超时由 `ToolContext.timeout` 控制
- 工具分类：文件读写、代码搜索、AST 查询、Shell 执行、浏览器自动化、Git 操作、HTTP 请求、MCP 集成、Office 文档生成

## BaseAgentRuntime

```typescript
abstract class BaseAgentRuntime {
  agentId: string;
  role: string;
  sessionId: string;
  
  // 生命周期
  start(): Promise<void>;
  stop(): Promise<void>;
  
  // 消息处理
  receiveMessage(message: AgentMessage): Promise<void>;
  
  // 工具执行
  executeTool(name: string, args: unknown): Promise<ToolResult>;
  
  // LLM 调用
  callLlm(messages: LlmMessage[]): Promise<LlmResponse>;
}
```

**契约规则：**
- Worker Agent 继承 BaseAgentRuntime
- 每个 Agent 有独立上下文，不共享状态
- Agent 通过 IPC 与 Leader 通信
- 状态转换：`idle → running → completed/failed`

## AgentPoolRuntime

```typescript
class AgentPoolRuntime {
  acquire(role: string): AgentWorker;       // 获取或创建 worker
  release(worker: AgentWorker): void;        // 归还到池
  destroy(): void;                           // 销毁所有 worker
  getActiveWorkers(): AgentWorker[];
}
```

**契约规则：**
- Agent Worker 是池化资源，用完归还
- 同角色可有多实例（fe-1, fe-2），由 write_scope 区分
- `destroy()` 顺序：释放每个 worker → WorkerProcessRunner.destroy() → 清理池
- 池大小无动态调整（⚠️ P2）

## FaultRecovery

```typescript
class FaultRecovery {
  handleCrash(workerId: string, error: Error): RecoveryDecision;
}

interface RecoveryDecision {
  action: 'respawn' | 'abort';
  delay?: number;                      // respawn 延迟（ms）
  maxRetries?: number;                 // 最大重试次数
}
```

**契约规则：**
- 崩溃后默认 respawn，最多 3 次（⚠️ P1-8: 硬编码）
- LLM 超时/网络错误属于瞬时类 → respawn
- 代码逻辑错误 → abort
- respawn 限制参数应配置化

## LlmGuard

```typescript
class LlmGuard {
  validateInput(messages: LlmMessage[]): GuardResult;
  validateOutput(response: LlmResponse): GuardResult;
}

interface GuardResult {
  passed: boolean;
  reason?: string;
  sanitized?: LlmMessage[] | LlmResponse;
}
```

**契约规则：**
- 输入验证：检测注入、敏感信息泄露
- 输出验证：检测有害内容
- 规则不可配置（⚠️ P1-10: 应外部化）

## ToolLoopDetector

```typescript
class ToolLoopDetector {
  recordCall(agentId: string, toolName: string, args: unknown): LoopResult;
  reset(agentId: string): void;
}

interface LoopResult {
  isLoop: boolean;
  confidence: number;                   // 0-1
  suggestion: 'continue' | 'warn' | 'block';
}
```

**契约规则：**
- 检测 Agent 是否陷入工具调用循环（相同工具 + 相同参数）
- 按 agentId 维度检测
- ⚠️ P1-9: 无跨 session 隔离

## 事件发射契约

LeaderAgent 通过 EventEmitter 发射的关键事件：

| 事件名 | 时机 | 数据结构 |
|--------|------|----------|
| `leader:status` | Leader 状态变更 | `{ status, sessionId }` |
| `leader:busy` | Leader 正在处理 | `{ sessionId, busy: true }` |
| `leader:round_complete` | 一轮处理完成 | `{ sessionId, round }` |
| `leader:plan_approved` | 方案被批准 | `{ sessionId, plan }` |
| `leader:plan_rejected` | 方案被拒绝 | `{ sessionId, reason }` |
| `leader:control_mode_changed` | 控制模式切换 | `{ mode, sessionId }` |
| `leader:blueprint_updated` | 项目蓝图更新 | `{ blueprint, sessionId }` |
| `leader:message_queued` | 消息入队 | `{ sessionId, queueLength }` |
| `leader:message_dequeued` | 消息出队 | `{ sessionId, queueLength }` |
| `leader:watchdog_alert` | 看门狗告警 | `{ agentId, sessionId, alert }` |
| `leader:progress_stagnant` | 进度停滞 | `{ sessionId, agentId }` |
| `leader:error` | Leader 错误 | `{ sessionId, error }` |
| `notification:new` | 通知 | `Notification` (见 sse-events.md) |
| `user:input_needed` | 需要用户输入 | `{ sessionId, question, questions }` |
