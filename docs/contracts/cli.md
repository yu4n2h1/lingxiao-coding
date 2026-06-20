# CLI 与配置契约

> 范围：`src/cli.ts` + `src/config.ts` + `src/cli_upgrade.ts` + `src/version.ts`

## 命令注册

```
lingxiao                    — 启动交互模式（TUI 或 WebUI）
lingxiao upgrade            — 检查并升级到最新版本
lingxiao upgrade --check    — 只检查不升级
lingxiao --version          — 显示版本号
lingxiao --help             — 显示帮助
lingxiao upgrade --help     — 显示升级帮助
```

### 命令入口流程

```
cli.ts: program.parse()
  │
  ├── 无命令 → 启动交互模式
  │   ├── 读取配置 → 检查模型配置
  │   ├── 创建 SessionManager
  │   ├── 创建 Fastify 服务器
  │   ├── 启动 TUI (cli-tui.ts) 或 WebUI
  │   └── 首次运行引导配置
  │
  └── upgrade → runUpgrade(opts)
      ├── fetchLatestRelease()
      ├── compareVersions()
      └── detectInstallType() → 升级路径
```

## 配置文件契约

### 文件位置
- 配置目录：`~/.lingxiao/`
- 主配置文件：`~/.lingxiao/config.json`
- 日志目录：`~/.lingxiao/logs/`
- 会话目录：`~/.lingxiao/sessions/`
- 记忆目录：`~/.lingxiao/memory/`

### Schema

```json
{
  "version": 1,
  "uiLanguage": "zh-CN",
  "defaultMode": "tui",
  "providers": {
    "openai": {
      "apiKey": "sk-...",
      "baseUrl": "https://api.openai.com/v1",
      "model": "gpt-4"
    },
    "anthropic": {
      "apiKey": "sk-ant-...",
      "baseUrl": "https://api.anthropic.com",
      "model": "claude-3-opus"
    }
  },
  "permissions": {
    "mode": "strict"
  },
  "mcp": {
    "servers": {}
  }
}
```

### 配置加载契约

```typescript
function loadSettings(): Settings {
  // 1. 读取 ~/.lingxiao/config.json
  // 2. JSON.parse 失败时 → ⚠️ P0-9: 当前直接抛异常
  //    修复后应：回退默认配置 + 备份损坏文件 + 提示用户
  // 3. 合并默认值
  // 4. 返回 Settings 对象
}
```

### 配置保存契约

```typescript
function saveSettings(settings: Settings): void {
  // 原子写入：临时文件 → rename
  // 触发 settingsWatcher 通知所有监听者
}
```

### 配置热加载

```typescript
function startSettingsWatcher(): void;
function stopSettingsWatcher(): void;
```

- 文件变更时自动重新加载配置
- 通过 EventEmitter 通知运行时组件

### 版本迁移

- ⚠️ P1-24: 当前无 schema version 迁移机制
- 修复后应：检查 `config.version` → 执行迁移函数 → 更新 version

## 升级流程契约

### 版本检查

```typescript
async function fetchLatestRelease(): Promise<ReleaseInfo> {
  // GitHub API: https://api.github.com/repos/hexian2001/lingxiao-coding/releases/latest
  // ⚠️ P1-22: 当前使用 spawnSync('curl')，应改用 native fetch
}
```

### 版本比较

```typescript
function compareVersions(a: string, b: string): number;
// 返回: 正数(a>b) | 0(相等) | 负数(a<b)
// 支持: "1.2.3" 和 "v1.2.3" 格式
```

### 安装类型检测

```typescript
type InstallType = 'portable' | 'npm' | 'source';

function detectInstallType(): { type: InstallType; installDir?: string };
```

**检测策略（优先级从高到低）：**
1. `which lingxiao` + `readlink -f` 反向追踪 → 查找 package.json
2. 从 `scriptPath`（dist 目录）推断项目根目录
3. Legacy fallback：查找 `lingxiao` / `lingxiao.cmd` 可执行文件

### 升级路径

| 安装类型 | 升级方式 | 回滚 |
|----------|----------|------|
| portable | `downloadAndExtract()` → `refreshSymlink()` | `.bak` 目录 ⚠️ P0-10 |
| source | `git fetch` → `git checkout tag` → `npm install` → `npm run build` → `npm link` | `git checkout v<old>` |
| npm | 提示 `npm update -g lingxiao_cli` | 手动 |

### 升级安全要求

- ⚠️ P0-10: 下载解压中断后安装目录不一致
- 修复要求：下载到临时目录 → 验证完整性 → 原子 rename 替换
- 旧版本备份到 `.bak` 目录
- `refreshSymlink` ⚠️ P1-23: 硬编码 `/usr/local/bin`，应动态解析

## UpdateChecker 契约

```typescript
class UpdateChecker {
  constructor(emitter: EventEmitter, getActiveSessionIds: () => string[]);
  start(): void;    // 延迟 10s + 24h 定期检查
  stop(): void;
}
```

**行为契约：**
- 启动后延迟 10s 异步检查 GitHub releases
- 使用 native `fetch`（非 spawnSync curl）
- 发现新版本时 emit `notification:new`
- 同版本不重复通知（进程生命周期内去重）
- 网络异常静默跳过
- 每 24h 定期检查

## 版本管理契约

```typescript
// version.ts
export const VERSION: string;           // 从 package.json 读取
export const PACKAGE_NAME: string;      // 'lingxiao_cli'
export const PRODUCT_NAME: string;      // 'lingxiao-cli'
export const PRODUCT_DISPLAY_NAME: string; // 'LingXiaoCLI'
```

### 版本号规则

- 语义化版本：`MAJOR.MINOR.PATCH`
- `npm run bump-version -- patch|minor|major`
- Git tag 格式：`v<version>`
- GitHub Release 自动从 tag 创建

## 依赖要求

- **Node.js**: >= 24.0.0（`package.json` engines）
- **npm**: 或兼容包管理器
- **构建依赖**: TypeScript 5.x, Vite 5.x
- **运行依赖**: better-sqlite3, fastify, react, ink, playwright, sharp, tesseract.js
