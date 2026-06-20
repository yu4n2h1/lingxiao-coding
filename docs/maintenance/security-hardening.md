# 安全加固指南

> 修复审计发现的安全漏洞：路径遍历、XSS、SSRF、认证缺失

## 1. 路径遍历修复（P0-5）

### 问题
`GitIntegrationApi.resolveReadWorkspace` 和 `resolveWriteWorkspace` 直接拼接用户输入的 workspace 路径，无边界校验。

**漏洞文件**: `src/web-server/GitIntegrationApi.ts:29-31`

### 修复方案

```typescript
import { resolve, relative } from 'path';

/**
 * 校验目标路径是否在允许的根目录内
 * @throws 403 如果路径逃逸
 */
function assertPathInside(target: string, root: string): void {
  const resolvedTarget = resolve(target);
  const resolvedRoot = resolve(root);
  const rel = relative(resolvedRoot, resolvedTarget);
  
  if (rel.startsWith('..') || resolve(resolvedRoot, rel) !== resolvedTarget) {
    throw new Error(`Path traversal detected: ${target} escapes ${root}`);
  }
}

// 在 resolveReadWorkspace 中使用
function resolveReadWorkspace(workspace: string, allowedRoots: string[]): string {
  const resolved = resolve(workspace);
  const isAllowed = allowedRoots.some(root => {
    try {
      assertPathInside(resolved, root);
      return true;
    } catch {
      return false;
    }
  });
  
  if (!isAllowed) {
    throw new Error(`Workspace not in allowed roots: ${workspace}`);
  }
  
  return resolved;
}
```

### 影响范围
- `src/web-server/GitIntegrationApi.ts` — resolveReadWorkspace / resolveWriteWorkspace
- `src/web-server/FileSystemRoutes.ts` — 已有 `validateFsPath`，确认一致
- `src/web-server/ArtifactPreviewRoutes.ts` — 已有 `validateArtifactPath`，确认一致

## 2. Token XSS 攻击链修复（P0-6）

### 问题
后端通过 `onSend` hook 注入 `window.__LINGXIAO_TOKEN__` 到 HTML，前端 McpAppRenderer 使用 `postMessage` with `targetOrigin='*'`，恶意内容可窃取 token。

**漏洞文件**:
- `src/server.ts:326-337` (token 注入)
- `web/src/components/chat/McpAppRenderer.tsx:114,190-219` (postMessage)

### 修复方案（分两步）

#### 步骤 1: Token 传递改用 HttpOnly Cookie

```typescript
// server.ts — 替换 onSend hook
// 移除: reply.header 注入 window.__LINGXIAO_TOKEN__
// 改为: 设置 HttpOnly cookie

fastify.addHook('onRequest', async (request, reply) => {
  const token = serverAuth.getToken();
  reply.setCookie('lingxiao_token', token, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
  });
});

// API 认证从 cookie 读取
// ServerAuth.ts
function validate(request: { headers, cookies }): boolean {
  const token = request.cookies?.lingxiao_token 
    ?? request.headers['x-lingxiao-token']
    ?? request.query?.token;
  return tokenEquals(token, this.token);
}
```

#### 步骤 2: postMessage 限定 targetOrigin

```typescript
// McpAppRenderer.tsx — 替换 targetOrigin='*'
const ALLOWED_ORIGINS = [
  window.location.origin,           // 同源
  'http://localhost:5173',          // 开发模式 Vite
];

function safePostMessage(iframe: HTMLIFrameElement, message: unknown) {
  const origin = new URL(iframe.src).origin;
  if (!ALLOWED_ORIGINS.includes(origin)) {
    console.warn(`Blocked postMessage to untrusted origin: ${origin}`);
    return;
  }
  iframe.contentWindow?.postMessage(message, origin);
}
```

### 迁移注意
- Cookie 方案需要前端 `AcpClient` 不再从 `window.__LINGXIAO_TOKEN__` 读取 token
- SSE 连接的 cookie 会自动携带（同源）
- WebSocket 连接需确认 cookie 传递

## 3. SSRF 防护（P1-14）

### 问题
GitIntegrationApi 和 BrowserRoutes 接受 URL 参数，未过滤内网地址。

### 修复方案

```typescript
const BLOCKED_HOSTNAMES = [
  /^127\./,                              // loopback
  /^10\./,                               // class A private
  /^172\.(1[6-9]|2[0-9]|3[01])\./,       // class B private
  /^192\.168\./,                          // class C private
  /^169\.254\./,                          // link-local
  /^::1$/,                                // IPv6 loopback
  /^fc00:/i,                              // IPv6 unique local
  /^fe80:/i,                              // IPv6 link-local
  /^0\./,                                 // current network
];

function isInternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    return BLOCKED_HOSTNAMES.some(re => re.test(hostname));
  } catch {
    return true;  // 无效 URL 视为内网（安全默认）
  }
}

function assertExternalUrl(url: string): void {
  if (isInternalUrl(url)) {
    throw new Error(`Blocked internal URL: ${url}`);
  }
}
```

### 应用位置
- `src/web-server/GitIntegrationApi.ts` — 所有接受 URL 参数的端点
- `src/web-server/BrowserRoutes.ts` — browser action 中的 URL 参数
- 任何使用 `http_request` 工具或 `fetch` 的后端代码

## 4. 认证补齐（P1-12）

### 问题
`TempDownloadRoutes` 无 `requireServerToken` 认证。

### 修复方案

```typescript
// TempDownloadRoutes.ts
import { requireServerToken } from './auth.js';

export function registerTempDownloadRoutes(
  fastify: FastifyInstance,
  deps: RouteDeps
): void {
  // 添加认证中间件
  fastify.addHook('preHandler', async (request, reply) => {
    if (!deps.serverAuth.validate(request)) {
      reply.code(401).send({ error: 'Unauthorized' });
      return reply;
    }
  });

  fastify.get('/api/download/:token', async (request, reply) => {
    // ... 原有逻辑
  });
}
```

### 替代方案
下载链接通常通过通知/聊天发送，用户直接点击。如果添加 header 认证会导致浏览器直接访问失败。替代方案：
- 使用短期一次性 token（5 分钟过期）
- token 参数通过 query 传递：`/api/download/:token?auth=<short-lived-token>`
- 下载完成后 token 作废

## 5. 认证中间件统一化（P1-16）

### 当前状态
认证散落在各路由文件中，方式不统一：
- `requireServerToken` (server.ts:276) — 快速中间件
- `serverAuth.validate` (ServerAuth.ts:73) — 直接调用
- `authorizeLocalLlmGatewayToken` (LocalLlmGatewayRoutes.ts:223) — 独立认证

### 修复方案

```typescript
// 统一为 Fastify preHandler 插件
export function createAuthPlugin(serverAuth: ServerAuth) {
  return fastifyPlugin(async (fastify) => {
    fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
      if (!serverAuth.validate(request)) {
        reply.code(401).send({ error: 'Unauthorized' });
        return reply;
      }
    });
    
    fastify.decorate('authenticateLlmGateway', async (request, reply) => {
      if (!authorizeLocalLlmGatewayToken(request)) {
        reply.code(401).send({ error: 'Unauthorized' });
        return reply;
      }
    });
  });
}

// 路由中使用
fastify.get('/api/session/:id', {
  preHandler: [fastify.authenticate],
  handler: getSessionHandler,
});
```

## 安全检查清单

修复完成后，按以下清单验证：

- [ ] 所有文件操作端点都有路径校验（`isPathInside`）
- [ ] token 不再通过 `window.__LINGXIAO_TOKEN__` 暴露
- [ ] postMessage 全部限定 targetOrigin
- [ ] URL 参数全部经过 SSRF 过滤
- [ ] 所有 API 端点都有认证（除静态文件）
- [ ] `timingSafeEqual` 用于所有 token 比较
- [ ] DOMPurify 用于所有 `dangerouslySetInnerHTML`
- [ ] 错误响应不泄露内部路径或堆栈
