# SSE 事件契约

> 后端 EventEmitter → SseBridge → 前端 sseStore/useTuiEventBridge 的事件映射

## 事件名映射表

| 后端事件名 | 前端 SessionUpdateKind | 方向 | 数据结构 |
|-----------|----------------------|------|----------|
| `session:created` | SessionCreated | → 前端 | `{ sessionId, session }` |
| `session:failed` | SessionFailed | → 前端 | `{ sessionId, error }` |
| `session:completed` | SessionCompleted | → 前端 | `{ sessionId }` |
| `session:renamed` | SessionRenamed | → 前端 | `{ sessionId, name }` |
| `session:interrupted` | StatusChange | → 前端 | `{ sessionId }` |
| `session:deleted` | — (内部) | 内部 | `{ sessionId }` |
| `session:runtime_state` | SessionRuntimeState | → 前端 | `RuntimeSnapshot` |
| `session:soul_extracted` | — (TUI 内部) | 内部 | `{ entryCount, soulPath }` |
| `task:created` | TaskUpdate | → 前端 | `{ task, sessionId }` |
| `task:updated` | TaskUpdate | → 前端 | `{ task, sessionId }` |
| `task:assigned` | TaskUpdate | → 前端 | `{ task, sessionId }` |
| `task:completed` | TaskUpdate | → 前端 | `{ task, sessionId }` |
| `task:failed` | TaskUpdate | → 前端 | `{ task, sessionId }` |
| `task:cancelled` | TaskUpdate | → 前端 | `{ task, sessionId }` |
| `task:deleted` | TaskUpdate | → 前端 | `{ task, sessionId }` |
| `agent:heartbeat` | AgentHeartbeat | → 前端 | `{ agentId, sessionId, status }` |
| `agent:interactive_state` | AgentInteractiveState | → 前端 | `{ agentId, sessionId, state }` |
| `agent:crashed` | AgentCrashed | → 前端 | `{ agentId, sessionId, error }` |
| `agent:error` | AgentError | → 前端 | `{ agentId, sessionId, error }` |
| `agent:tool_output` | ToolOutput | → 前端 | `{ agentId, sessionId, output }` |
| `agent:shell_state` | ShellState | → 前端 | `{ agentId, sessionId, state }` |
| `agent:tool_progress` | AgentToolProgress | → 前端 | `{ agentId, sessionId, progress }` |
| `agent:context_updated` | AgentContextUpdated | → 前端 | `{ agentId, sessionId, tokens }` |
| `notification:new` | Notification | → 前端 | `Notification` |
| `notification:mark_read` | — (TUI 内部) | 内部 | `{ notificationId }` |
| `leader:status` | StatusChange | → 前端 | `{ sessionId, status }` |
| `leader:busy` | LeaderBusy | → 前端 | `{ sessionId, busy }` |
| `leader:round_complete` | LeaderRoundComplete | → 前端 | `{ sessionId, round }` |
| `leader:error` | Error | → 前端 | `{ sessionId, error }` |
| `leader:message_queued` | LeaderMessageQueued | → 前端 | `{ sessionId, queueLength }` |
| `leader:message_dequeued` | LeaderMessageDequeued | → 前端 | `{ sessionId, queueLength }` |
| `leader:plan_approved` | PlanApproved | → 前端 | `{ sessionId, plan }` |
| `leader:plan_rejected` | PlanRejected | → 前端 | `{ sessionId, reason }` |
| `leader:control_mode_changed` | ControlModeChanged | → 前端 | `{ sessionId, mode }` |
| `leader:blueprint_updated` | BlueprintUpdated | → 前端 | `{ sessionId, blueprint }` |
| `leader:watchdog_alert` | WatchdogAlert | → 前端 | `{ sessionId, agentId, alert }` |
| `leader:progress_stagnant` | ProgressStagnant | → 前端 | `{ sessionId, agentId }` |
| `leader:tool_progress` | ToolProgress | → 前端 | `{ sessionId, progress }` |
| `plan:submitted` | PlanSubmitted | → 前端 | `{ sessionId, plan }` |
| `plan:updated` | PlanUpdated | → 前端 | `{ sessionId, plan }` |
| `plan:finalized` | PlanFinalized | → 前端 | `{ sessionId, status }` |
| `permission:request` | InterruptionRequest | → 前端 | `{ sessionId, request }` |
| `permission:resolved` | InterruptionResolved | → 前端 | `{ sessionId, requestId }` |
| `permission:mode_changed` | PermissionModeChanged | → 前端 | `{ sessionId, mode }` |
| `user:input_needed` | AskUserQuestion | → 前端 | `{ sessionId, question, questions }` |
| `user:question_answered` | AskUserAnswered | → 前端 | `{ sessionId, answers }` |
| `blackboard:delta` | BlackboardDelta | → 前端 | `{ sessionId, delta }` |
| `blackboard:initialized` | BlackboardInitialized | → 前端 | `{ sessionId, graph }` |
| `team:message_sent` | TeamMessageSent | → 前端 | `{ sessionId, message }` |
| `team:message_read` | TeamMessageRead | → 前端 | `{ sessionId, messageId }` |
| `work_note:written` | WorkNoteWritten | → 前端 | `{ sessionId, note }` |
| `orchestration:run_state` | OrchestrationRunState | → 前端 | `{ sessionId, run }` |
| `orchestration:dag_updated` | OrchestrationDagUpdate | → 前端 | `{ sessionId, dag }` |
| `orchestration:node_update` | OrchestrationNodeUpdate | → 前端 | `{ sessionId, node }` |
| `orchestration:event_applied` | OrchestrationEventApplied | → 前端 | `{ sessionId, event }` |
| `orchestration:event_rejected` | OrchestrationEventRejected | → 前端 | `{ sessionId, event }` |
| `run:explanation_updated` | RunExplanationUpdate | → 前端 | `{ sessionId, explanation }` |
| `context:compressed` | ContextCompressed | → 前端 | `{ sessionId, agentId }` |
| `context:compacting` | ContextCompacting | → 前端 | `{ sessionId, agentId }` |
| `context:runtime_updated` | ContextRuntimeUpdated | → 前端 | `{ sessionId, manifest }` |
| `context:overflow` | ContextOverflow | → 前端 | `{ sessionId, agentId }` |
| `token:usage` | AgentTokenUsage | → 前端 | `{ sessionId, agentId, usage }` |
| `terminal:output` | TerminalOutput | → 前端 | `{ terminalId, output }` |
| `terminal:state` | TerminalState | → 前端 | `{ terminalId, state }` |
| `eternal:goal_changed` | EternalGoalChanged | → 前端 | `{ sessionId, goal }` |
| `plugin:toggled` | — (转发) | → 前端 | `{ sessionId, plugin }` |
| `skill:invoked` | — (TUI 内部) | 内部 | `{ sessionId, skills }` |

## 核心数据结构

### Notification

```typescript
interface Notification {
  id: string;                          // 唯一 ID
  sessionId?: string;                  // 目标 session
  type: string;                        // 'user_input_needed' | 'agent_warning' | 'update_available' | ...
  priority: 'critical' | 'important' | 'normal';
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  duplicateCount?: number;
}
```

### RuntimeSnapshot

```typescript
interface RuntimeSnapshot {
  sessionId: string;
  status: 'idle' | 'running' | 'waiting_for_user' | 'error' | 'completed';
  controlMode: 'manual' | 'eternal';
  executionMode: 'direct' | 'hybrid' | 'delegate';
  agents: AgentInfo[];
  tasks: TaskInfo[];
  contextTokens: { used: number; limit: number };
  notifications: Notification[];
  team?: TeamInfo;
  blueprint?: ProjectBlueprint;
}
```

### TaskBridgeEvent

```typescript
// Task 事件统一使用 TaskBoard 的 canonical payload
interface TaskBridgePayload<T extends TaskBridgeEvent> {
  task: TaskRecord;
  sessionId: string;
}
```

## SseBridge 事件转发分类

### SESSION_FORWARD_EVENTS（会话级广播）
直接调用 `broadcastSessionEvent(event, data, sessionId)`，数据中必须包含 `sessionId`。

### AGENT_FORWARD_EVENTS（Agent 级转发）
调用 `broadcastAgentSessionEvent(event, agentId, sessionId, data)`，需要 `agentId` + `sessionId` 双重路由。

### 非对称事件（需特殊处理）
| 事件 | 特殊处理 |
|------|----------|
| `notification:new` | 从 `data.sessionId ?? data.notification?.sessionId` 提取 sessionId |
| `leader:message_dequeued` | 仅需 `data.sessionId` |
| `agent:error` | error 对象序列化 + 补充 agentId |
| `task:*` | 从 `data.task.session_id` 提取 sessionId |
| `plugin:toggled` | 从 `data.sessionId` 路由 |
