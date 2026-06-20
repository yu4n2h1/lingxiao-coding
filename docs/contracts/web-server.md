# Web 服务器层契约

> 范围：`src/web-server/` + `src/server.ts`

## 服务器架构

```
server.ts (createServerWithDeps)
  │
  ├── Fastify 实例
  │   ├── @fastify/cors          (origin: false, 单机本地)
  │   ├── @fastify/websocket     (交互式终端)
  │   ├── @fastify/rate-limit    (200 req/min/IP)
  │   ├── static                 (web/dist 静态文件)
  │   └── onSend hook            (注入 token ⚠️ P0-6)
  │
  ├── 基础设施
  │   ├── ServerAuth             (token 认证)
  │   ├── ConnectionManager      (SSE 连接池, MAX=100)
  │   └── SseBridge              (事件桥接)
  │
  └── 路由注册 (22 个)
      ├── SessionRoutes          (会话管理)
      ├── SettingsRoutes         (设置)
      ├── FileSystemRoutes       (文件读写)
      ├── ArtifactPreviewRoutes  (产物预览)
      ├── TempDownloadRoutes     (临时下载 ⚠️ P1-12: 缺认证)
      ├── GitIntegrationApi      (Git 操作 ⚠️ P0-5: 路径遍历)
      ├── WikiRoutes             (Wiki)
      ├── ContractRoutes         (契约)
      ├── DaemonRoutes           (守护进程)
      ├── StatsRoutes            (统计)
      ├── WorkflowRoutes         (工作流)
      ├── TerminalRoutes         (终端 WebSocket)
      ├── AcpRoutes              (ACP SSE 端点)
      └── LocalLlmGatewayRoutes  (本地 LLM 网关)
```

## 认证契约

### ServerAuth

```typescript
class ServerAuth {
  validate(request: { headers, query? }): boolean;
  getToken(): string;                   // 生成新 token
}
```

**认证方式：**
- Header: `x-lingxiao-token: <token>`
- Query: `?token=<token>`
- 使用 `timingSafeEqual` 常量时间比较（防时序攻击）

### 认证要求

| 端点类型 | 认证要求 | 当前状态 |
|----------|----------|----------|
| REST API | `requireServerToken` | ✅ (除 TempDownloadRoutes) |
| SSE 端点 | `requireServerToken` | ✅ |
| WebSocket | `requireServerToken` | ✅ |
| 临时下载 | 无 | ⚠️ P1-12: 需添加 |
| 本地 LLM 网关 | `authorizeLocalLlmGatewayToken` | ✅ 独立认证 |
| 静态文件 | 无（同源访问） | ✅ |

### Token 传递机制

- ⚠️ **P0-6**: 当前通过 `onSend` hook 注入 `window.__LINGXIAO_TOKEN__` 到 HTML
- **修复方向**: 改用 HttpOnly cookie + CSRF token

## API 端点清单

### 会话管理

| 方法 | 路径 | 认证 | 描述 |
|------|------|------|------|
| GET | `/api/sse` | ✓ | SSE 事件流（长连接） |
| GET | `/api/session/:id` | ✓ | 获取会话状态 |
| POST | `/api/session/:id/message` | ✓ | 发送用户消息 |
| POST | `/api/session/:id/interrupt` | ✓ | 中断当前操作 |
| GET | `/api/session/active` | ✓ | 获取活跃会话 |
| POST | `/api/session` | ✓ | 创建新会话 |
| DELETE | `/api/session/:id` | ✓ | 删除会话 |

### 文件系统

| 方法 | 路径 | 认证 | 描述 | 安全 |
|------|------|------|------|------|
| GET | `/api/fs/*` | ✓ | 读取文件 | ✅ `validateFsPath` |
| POST | `/api/fs/*` | ✓ | 写入文件 | ✅ `validateFsPath` |

### Git 操作

| 方法 | 路径 | 认证 | 描述 | 安全 |
|------|------|------|------|------|
| GET | `/api/git/status` | ✓ | Git 状态 | ⚠️ P0-5: `resolveReadWorkspace` 无路径校验 |
| POST | `/api/git/commit` | ✓ | 提交 | ⚠️ P0-5: `resolveWriteWorkspace` 无路径校验 |
| POST | `/api/git/push` | ✓ | 推送 | ✅ |
| GET | `/api/git/log` | ✓ | 日志 | ⚠️ P0-5 |

### 其他端点

| 方法 | 路径 | 认证 | 描述 |
|------|------|------|------|
| GET | `/api/settings` | ✓ | 获取设置 |
| PUT | `/api/settings` | ✓ | 更新设置 |
| GET | `/api/stats` | ✓ | 统计数据 |
| GET | `/api/download/:token` | ✗ | 临时文件下载 |
| GET | `/api/artifact/*` | ✓ | 产物预览 |
| POST | `/api/workflow/*` | ✓ | 工作流操作 |
| WS | `/api/terminal/:id` | ✓ | 交互式终端 |
| POST | `/api/llm-gateway/*` | ✓ (独立) | 本地 LLM 网关 |

## ConnectionManager

```typescript
class ConnectionManager {
  addConnection(sessionId: string, res: ServerResponse): string;  // 返回 connId
  removeConnection(connId: string): void;
  broadcastToSession(sessionId: string, event: string, data: unknown): void;
  getSessionConnections(sessionId: string): number;
  getTotalConnections(): number;
}
```

**契约规则：**
- MAX_TOTAL_CONNECTIONS = 100（背压防护）
- 连接关闭时必须 `removeConnection`，防止泄漏
- `broadcastToSession` 遍历连接列表，写入失败时自动移除
- 全局连接数超限时拒绝新连接

## SseBridge

```typescript
class SseBridge {
  constructor(emitter: EventEmitter, connectionManager: ConnectionManager);
  start(): void;
  stop(): void;                        // 清理所有订阅和定时器
  destroy(): void;                     // stop + 释放 ConnectionManager
}
```

**契约规则：**
- 订阅 EventEmitter 事件 → 转发到对应 session 的 SSE 连接
- heartbeatInterval 定期发送心跳（⚠️ P1-13: 缺 unref）
- 事件转发分三类：
  - `SESSION_FORWARD_EVENTS`: 会话级事件
  - `AGENT_FORWARD_EVENTS`: Agent 级事件
  - 非对称事件：需特殊处理的事件（如 `notification:new`）

## 安全要求

### 路径校验（P0-5 修复要求）

```typescript
import { resolve, relative } from 'path';

function isPathInside(target: string, root: string): boolean {
  const rel = relative(root, target);
  return !rel.startsWith('..') && !resolve(root, rel).startsWith('..');
}

// 所有文件操作入口必须校验
```

### SSRF 防护（P1-14 修复要求）

```typescript
const BLOCKED_RANGES = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2[0-9]|3[01])\./, /^192\.168\./, /^169\.254\./
];

function isInternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return BLOCKED_RANGES.some(re => re.test(parsed.hostname));
  } catch { return true; }  // 无效 URL 视为内网
}
```

### 速率限制

- 当前：200 req/min/IP（`@fastify/rate-limit`）
- ⚠️ P2: 不可配置，建议外部化

### CORS

- 当前：`origin: false`（不发送 CORS 头，仅同源访问）
- 适用于单机本地运行模式
