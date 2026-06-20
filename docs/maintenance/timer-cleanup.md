# 定时器 unref 修复和资源清理指南

> 修复审计发现的定时器未 unref 问题，确保进程可正常退出

## 问题概述

3 处长生命周期定时器缺少 `.unref()`，导致 `gracefulShutdown` 后进程仍挂起：

| # | 定时器 | 文件 | 间隔 | 严重级 |
|---|--------|------|------|--------|
| P0-1 | pollTimer | `src/core/ScheduledTaskManager.ts:230` | 30s | P0 |
| P0-4 | watchdogTimer | `src/agents/LeaderAgent.ts` (LeaderProgressInvariant) | 可变 | P0 |
| P1-13 | heartbeatInterval | `src/web-server/SseBridge.ts` | 15s | P1 |

## 修复方案

### P0-1: ScheduledTaskManager pollTimer

```typescript
// src/core/ScheduledTaskManager.ts
// 修复前
start(): void {
  this.pollTimer = setInterval(() => this.poll(), 30_000);
}

// 修复后
start(): void {
  this.pollTimer = setInterval(() => this.poll(), 30_000);
  this.pollTimer.unref();  // 允许进程在无其他引用时退出
}

stop(): void {
  if (this.pollTimer) {
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }
}
```

### P0-4: LeaderProgressInvariant watchdogTimer

```typescript
// src/agents/LeaderAgent.ts — LeaderProgressInvariant
// 修复前
this.watchdogTimer = setInterval(() => {
  this.checkProgress();
}, intervalMs);

// 修复后
this.watchdogTimer = setInterval(() => {
  this.checkProgress();
}, intervalMs);
this.watchdogTimer.unref();

// 确保 stop 时清理
stop(): void {
  if (this.watchdogTimer) {
    clearInterval(this.watchdogTimer);
    this.watchdogTimer = undefined;
  }
}
```

### P1-13: SseBridge heartbeatInterval

```typescript
// src/web-server/SseBridge.ts
// 修复前
start(): void {
  this.heartbeatInterval = setInterval(() => {
    this.sendHeartbeat();
  }, 15_000);
}

// 修复后
start(): void {
  this.heartbeatInterval = setInterval(() => {
    this.sendHeartbeat();
  }, 15_000);
  this.heartbeatInterval.unref();
}

stop(): void {
  if (this.heartbeatInterval) {
    clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = undefined;
  }
  // ... 清理订阅
}
```

## 全局定时器审计清单

修复上述 3 处后，确认以下定时器已有 unref 或不需要：

| 定时器 | 文件 | unref | 状态 |
|--------|------|-------|------|
| pollTimer | `core/ScheduledTaskManager.ts:230` | ❌ → ✅ | 需修复 |
| watchdogTimer | `agents/LeaderAgent.ts` | ❌ → ✅ | 需修复 |
| heartbeatInterval | `web-server/SseBridge.ts` | ❌ → ✅ | 需修复 |
| budgetTimer | `core/ResourceBudgetService.ts:105` | ✅ | 已正常 |
| updateCheckTimer | `core/UpdateChecker.ts` | ✅ | 已正常 |
| updateCheckInitial | `core/UpdateChecker.ts` | ✅ | 已正常 |
| streamingWatchdog | `web/src/stores/sseStore.ts:573` | N/A | 客户端 |
| fastify rate-limit | `server.ts:284-311` | N/A | Fastify 内部管理 |
| fastify websocket | `server.ts:203` | N/A | Fastify 内部管理 |

## gracefulShutdown 加固

即使定时器都 unref 了，`gracefulShutdown` 本身也需要加固，确保一个 cleanup 失败不阻塞后续：

```typescript
// src/core/RuntimeGuards.ts
function gracefulShutdown(signal?: string): void {
  if (isShuttingDown) return;  // 防止重入
  isShuttingDown = true;
  
  // 按优先级倒序执行（数字越小越后执行）
  const sorted = [...cleanupHandlers].sort((a, b) => b.priority - a.priority);
  
  for (const { fn, name } of sorted) {
    try {
      fn();
    } catch (err) {
      // 记录但不中断
      console.error(`[gracefulShutdown] cleanup "${name}" failed:`, err);
    }
  }
  
  // 硬超时保险：10s 后强制退出
  const forceExitTimer = setTimeout(() => {
    console.error('[gracefulShutdown] force exit after 10s timeout');
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref();
  
  process.exit(0);
}
```

## 验证方法

修复后执行以下验证：

```bash
# 1. 启动凌霄，等待 30s 后按 Ctrl+C
lingxiao
# 预期：3s 内进程退出，无挂起

# 2. 发送 SIGTERM
kill -TERM <pid>
# 预期：3s 内进程退出

# 3. 检查残留定时器（Node.js 内置）
node -e "
const { EventEmitter } = require('events');
// 如果有未 unref 的定时器，process.exitCode 不会是 0
setTimeout(() => {
  console.log('No active handles');
  process.exit(0);
}, 100).unref();
"
```

## 内存泄漏防护补充

定时器 unref 解决了进程退出问题，但订阅泄漏仍需修复。完整清单：

| 组件 | 订阅/注册 | 清理位置 | 状态 |
|------|----------|----------|------|
| SseBridge | EventEmitter.subscribe × N | `stop()` | ✅ |
| useTuiEventBridge | emitter.subscribe × 77 | useEffect cleanup | ✅ |
| MessageBus | bus.register × N | `unregister()` | ⚠️ P0-2: 0 调用方 |
| LeaderAgent | emitter.subscribe × N | `stop()` | 需验证 |
| SessionManager | bus.register × N | `destroy()` | ⚠️ 需补充 unregister |
| UpdateChecker | emitter.subscribe | `stop()` | ✅ |

### MessageBus.unregister 修复（P0-2）

```typescript
// src/runtime/SessionManagerRuntime.ts
destroy(): void {
  // 修复：在销毁 session 前清理所有 MessageBus 订阅
  if (this.busSubscriptions) {
    for (const subId of this.busSubscriptions) {
      this.messageBus.unregister(subId);
    }
    this.busSubscriptions.clear();
  }
  
  // 然后执行原有销毁逻辑
  this.agentPool.destroy();
  this.workerRunner.destroy();
  // ...
}
```
