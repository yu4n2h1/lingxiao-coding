# 前端层契约

> 范围：`web/src/`（WebUI, React 19 + Vite）+ `src/tui/`（TUI, Ink）

## WebUI 架构

```
App.tsx
  ├── ErrorBoundary
  ├── ToastProvider                    (全局通知)
  ├── InkBackground                    (动态背景)
  ├── Sidebar (会话列表)
  ├── MainArea
  │   ├── ChatPanel (对话)
  │   ├── TaskBoard (任务面板)
  │   ├── AgentPanel (Agent 状态)
  │   ├── BlackboardPanel (黑板)
  │   └── TerminalPanel (终端)
  └── StatusBar (底部状态栏)
```

## 状态管理（Zustand）

### Store 分层

| Store | 文件 | 职责 |
|-------|------|------|
| sessionStore | `stores/sessionStore.ts` | 会话列表、当前会话、会话状态 |
| sseStore | `stores/sseStore.ts` | SSE 连接、事件分发、实时更新 |
| sessionStoreHelpers | `stores/sessionStoreHelpers.ts` | 内存防护常量、工具函数 |

### sseStore 契约

```typescript
// SSE 事件统一入口
function handleSessionUpdate(update: SessionUpdate): void;

// SessionUpdate 结构
interface SessionUpdate {
  kind: SessionUpdateKind;             // 见 sse-events.md 映射表
  sessionId: string;
  // ... 根据 kind 不同有不同的附加字段
}
```

**契约规则：**
- 所有 SSE 事件通过 `handleSessionUpdate()` 统一分发
- 每种 `SessionUpdateKind` 对应一个 case 分支
- 状态更新使用不可变模式：`setState((s) => ({ ...s, field: newValue }))`
- 通知列表上限 50 条（FIFO 封顶）
- ⚠️ P0-7: 1400+ 行巨型文件，需拆分

### 内存防护常量

```typescript
// sessionStoreHelpers.ts
const MAX_NOTIFICATIONS = 50;           // 通知列表上限
const MAX_AGENTS = 100;                 // Agent 列表上限
const MAX_MESSAGES = 5000;              // 消息列表上限
const MAX_TASKS = 200;                  // 任务列表上限
```

### SSE 连接管理

```typescript
// AcpClient.ts
class AcpClient {
  connect(token: string): void;         // 建立 SSE 连接
  disconnect(): void;
  reconnect(): void;                    // 自动重连
  sendMessage(sessionId: string, msg: string): Promise<void>;
}
```

**重连机制：**
- 双层重连：AcpClient 层 + sseStore 层
- 重连退避：1s → 2s → 5s → 10s → 30s
- ⚠️ P1-17: 重连竞态 — 重连中可能收到旧连接事件

## TUI 架构

```
LingXiaoTUI.tsx (2800+ 行 ⚠️ P0-8)
  ├── InputBar (用户输入)
  ├── MessageList (消息列表)
  ├── TaskBoard (任务面板)
  ├── AgentStatusBar (Agent 状态)
  ├── NotificationBanner (通知)
  └── CommandPalette (命令面板)
```

### 事件桥接契约

```typescript
// useTuiEventBridge.ts
function useTuiEventBridge(emitter: EventEmitter): void {
  useEffect(() => {
    const unsubscribers: (() => void)[] = [];

    // 每个事件订阅
    unsubscribers.push(
      emitter.subscribe('event:name', scoped('event:name', (event) => {
        // 处理事件
      }))
    );

    // cleanup: 全部取消订阅
    return () => {
      unsubscribers.forEach(fn => fn());
    };
  }, [/* 依赖 */]);
}
```

**契约规则：**
- 所有 `subscribe` 返回的 unsubscribe 必须在 `useEffect` cleanup 中调用
- 当前 77 个订阅全部配对清理（审计验证通过）
- `scoped()` 确保事件只处理当前 session
- 通知列表上限 500 条（FIFO 封顶）

### 通知消费

```typescript
// notification:new 事件处理
emitter.subscribe('notification:new', (event) => {
  if (!event.id) return;
  const notification = event as Notification;
  
  setNotifications(prev => {
    // 去重：相同 id 跳过
    if (prev.some(item => item.id === notification.id)) return prev;
    
    // 相似去重：5s 内相同 type + title 视为重复
    const similarThreshold = 5000;
    // ... 合并重复通知
    
    // FIFO 封顶 500 条
    const MAX = 500;
    const next = prev.length >= MAX ? prev.slice(prev.length - MAX + 1) : prev;
    return [...next, notification];
  });
});
```

## 前端安全要求

### XSS 防护

| 场景 | 防护措施 | 当前状态 |
|------|----------|----------|
| Markdown 渲染 | DOMPurify 过滤 | ✅ `SafeMarkdown.tsx:76-91` |
| HTML 插入 | `dangerouslySetInnerHTML` 5 处 | ✅ 全部有 DOMPurify |
| iframe 通信 | `postMessage` targetOrigin | ⚠️ P1-19: McpAppRenderer 使用 `'*'` |
| Token 存储 | `window.__LINGXIAO_TOKEN__` | ⚠️ P0-6: 应改用 HttpOnly cookie |

### SSE 重连安全
- 重连时生成新 connectionId，丢弃旧连接事件（⚠️ P1-17: 当前未实现）
- Token 通过 header 传递，不暴露在 URL 中

## WebUI ↔ TUI 共享契约

两端消费相同的 SSE 事件，但实现独立：
- WebUI: React + Zustand + AcpClient (SSE)
- TUI: Ink + useState + EventEmitter (直接订阅)

**数据一致性保证：**
- 两端都从 `session:runtime_state` 快照校准状态
- 流式事件负责实时体验，快照负责一致性
- 通知 ID 全局唯一，两端可安全去重
