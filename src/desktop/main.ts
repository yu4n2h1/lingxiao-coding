/**
 * Electron 主进程入口 — 桌面端自动更新与 IPC
 *
 * 仅在 Electron 环境下运行；通过动态 import electron-updater 避免在非桌面构建中引入硬依赖。
 * 暴露 IPC 通道：update:status / update:relaunch / update:checkAndDownload
 * 事件通道：update:downloaded / update:downloadProgress / update:error
 *
 * 启动流程：
 * 1. Electron app ready
 * 2. 检查端口是否已有后端服务（用户可能已手动启动 daemon）
 * 3. 如果没有 → fork 后端 daemon 子进程，等待端口就绪
 * 4. 创建 BrowserWindow，先显示 loading 页面，端口就绪后 loadURL 后端
 * 5. app quit 时 kill 后端子进程
 */

// 动态加载 electron 和 electron-updater（非桌面环境不会执行此文件）
import type { app as AppType, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { fork, type ChildProcess } from 'child_process';
import { createConnection } from 'net';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join as pathJoin } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** 后端服务子进程引用 */
let backendProcess: ChildProcess | null = null;

interface AutoUpdaterModule {
  autoUpdater: {
    checkForUpdatesAndNotify: () => Promise<unknown>;
    checkForUpdates: () => Promise<{ downloadPromise?: Promise<unknown> } | null>;
    downloadUpdate: () => Promise<unknown>;
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    quitAndInstall: () => void;
  };
}

let updateDownloaded = false;
let updateVersion: string | null = null;
let mainWindow: BrowserWindow | null = null;

/**
 * 启动桌面端更新检查与 IPC 通道注册。
 * 在 Electron app ready 之后调用。
 */
export async function startDesktopUpdater(
  electron: typeof import('electron'),
  updaterModule: AutoUpdaterModule,
): Promise<void> {
  const { app, ipcMain: ipc, BrowserWindow: Win } = electron;
  const { autoUpdater } = updaterModule;

  // --- IPC: 查询更新状态 ---
  ipc.handle('update:status', () => ({
    updateDownloaded,
    updateVersion,
  }));

  // --- IPC: 重启应用 ---
  ipc.handle('update:relaunch', () => {
    app.relaunch();
    app.exit(0);
  });

  // --- IPC: 检查并下载更新 ---
  ipc.handle('update:checkAndDownload', async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      if (result) {
        // checkForUpdates 返回 UpdateCheckResult，如果有更新会自动开始下载
        // 但在某些配置下需要手动调用 downloadUpdate
        await autoUpdater.downloadUpdate();
      }
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update:error', { message });
      }
      return { success: false, error: message };
    }
  });

  // --- electron-updater 事件: 下载进度 ---
  autoUpdater.on('download-progress', (progress: unknown) => {
    const p = progress as { percent?: number; transferred?: number; total?: number };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:downloadProgress', {
        percent: p?.percent ?? 0,
        transferred: p?.transferred ?? 0,
        total: p?.total ?? 0,
      });
    }
  });

  // --- electron-updater 事件: 错误 ---
  autoUpdater.on('error', (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:error', { message });
    }
  });

  // --- electron-updater 事件: 下载完成 ---
  autoUpdater.on('update-downloaded', (info: unknown) => {
    const releaseInfo = info as { version?: string };
    updateDownloaded = true;
    updateVersion = releaseInfo?.version ?? null;

    // 通知所有渲染进程
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:downloaded', { updateVersion });
    }
  });

  // 自动检查更新
  try {
    await autoUpdater.checkForUpdatesAndNotify();
  } catch {
    // 静默失败 — 开发环境或无网络时不影响使用
  }

  // 定期检查（每4小时）
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }, 4 * 60 * 60 * 1000);
}

/**
 * 设置主窗口引用，用于向渲染进程发送 IPC 消息。
 */
export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}

// ─── 后端服务管理 ──────────────────────────────────────────────────

/**
 * 读取 ~/.lingxiao/port 文件，获取已运行 daemon 的端口信息。
 * 返回 null 表示没有正在运行的 daemon。
 */
function readPortFile(): { pid: number; port: number; host: string; startedAt: number } | null {
  const portFilePath = pathJoin(homedir(), '.lingxiao', 'port');
  if (!existsSync(portFilePath)) return null;
  try {
    const data = JSON.parse(readFileSync(portFilePath, 'utf-8'));
    // 检查进程是否仍在运行 — 发信号 0 检测
    try {
      process.kill(data.pid, 0);
    } catch {
      return null; // 进程已退出
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * 检查端口是否已有服务在监听。
 * 如果已有服务（可能是用户手动启动的 daemon），则跳过 fork 后端。
 */
async function isPortAlive(port: number, host = 'localhost'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    // 500ms 超时
    setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 500);
  });
}

/**
 * 等待端口就绪，最多等 30 秒。
 */
async function waitForPort(port: number, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortAlive(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * 等待 port file 出现并返回实际端口，最多等 30 秒。
 * 用于 fork 后端后获取随机分配的端口。
 */
async function waitForPortFile(timeoutMs = 30_000): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = readPortFile();
    if (info && info.port > 0) return info.port;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/**
 * Fork 后端服务子进程（daemon 模式）。
 * 传 LINGXIAO_WEB_PORT=0 让后端使用随机端口（random_port），
 * 后端启动后会写入 ~/.lingxiao/port 文件，桌面端读取该文件获取实际端口。
 */
function spawnBackend(): ChildProcess {
  // 定位 dist/cli.js — 在 asar 包内或开发目录
  const cliPath = join(__dirname, '..', 'cli.js');
  console.log(`[desktop] Spawning backend: ${cliPath} (random port)`);

  const child = fork(cliPath, ['daemon'], {
    env: {
      ...process.env,
      LINGXIAO_DAEMON_MODE: '1',
      LINGXIAO_WEB_PORT: '0',
      LINGXIAO_SKIP_MODELS_SNAPSHOT: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (data: Buffer) => {
    console.log(`[backend] ${data.toString().trim()}`);
  });
  child.stderr?.on('data', (data: Buffer) => {
    console.error(`[backend] ${data.toString().trim()}`);
  });
  child.on('exit', (code, signal) => {
    console.log(`[desktop] Backend process exited: code=${code} signal=${signal}`);
    backendProcess = null;
  });

  return child;
}

/**
 * 终止后端子进程。
 */
function killBackend(): void {
  if (backendProcess && !backendProcess.killed) {
    console.log('[desktop] Killing backend process...');
    backendProcess.kill('SIGTERM');
    // 给 2 秒优雅退出，然后强制 kill
    setTimeout(() => {
      if (backendProcess && !backendProcess.killed) {
        backendProcess.kill('SIGKILL');
      }
    }, 2000);
  }
}

/**
 * 显示加载中页面（内嵌 HTML，不依赖后端）。
 */
function showLoadingScreen(win: BrowserWindow): void {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { margin:0; height:100vh; display:flex; align-items:center; justify-content:center;
         background:#0B0E11; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .container { text-align:center; }
  .spinner { width:40px; height:40px; border:3px solid #1a2a2a; border-top-color:#5FE0C7;
             border-radius:50%; animation:spin 1s linear infinite; margin:0 auto 20px; }
  .title { color:#E8E4D8; font-size:20px; font-weight:600; margin-bottom:8px; }
  .subtitle { color:#5FE0C7; font-size:14px; opacity:0.7; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head><body>
<div class="container">
  <div class="spinner"></div>
  <div class="title">凌霄剑域</div>
  <div class="subtitle">正在启动后端服务...</div>
</div>
</body></html>`;
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

/**
 * 显示错误页面（后端启动失败）。
 */
function showErrorScreen(win: BrowserWindow): void {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { margin:0; height:100vh; display:flex; align-items:center; justify-content:center;
         background:#0B0E11; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .container { text-align:center; max-width:420px; }
  .icon { font-size:48px; margin-bottom:16px; }
  .title { color:#E5484D; font-size:20px; font-weight:600; margin-bottom:12px; }
  .desc { color:#888; font-size:14px; line-height:1.6; margin-bottom:20px; }
  .retry { background:#5FE0C7; color:#0B0E11; border:none; padding:10px 28px;
           border-radius:6px; font-size:14px; cursor:pointer; }
  .retry:hover { background:#4FD0B7; }
</style>
</head><body>
<div class="container">
  <div class="icon">⚠</div>
  <div class="title">后端服务启动失败</div>
  <div class="desc">凌霄后端服务未能正常启动。请检查日志或尝试重新启动应用。</div>
  <button class="retry" onclick="location.reload()">重试</button>
</div>
</body></html>`;
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

/**
 * 创建桌面端应用窗口。
 * 此函数仅在 Electron 环境中被调用。
 */
export async function createDesktopWindow(
  port: number,
): Promise<void> {
  // 动态导入 electron
  const electron = await import('electron');
  const { app, BrowserWindow } = electron;

  await app.whenReady();

  // 性能优化 (T-8)：GPU 进程崩溃处理 — exe 打包后在部分 Windows 机器上 GPU
  // 进程可能崩溃导致软件渲染卡顿。监听 child-process-gone 事件记录 GPU 崩溃。
  app.on('child-process-gone', (_event: unknown, details: { reason?: string; type?: string; exitCode?: number }) => {
    if (details?.type === 'GPU') {
      console.error('[desktop] GPU child process gone:', details.reason, 'exitCode:', details.exitCode);
    }
  });

  // app 退出时清理后端子进程
  app.on('before-quit', () => {
    killBackend();
  });

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      preload: `${__dirname}/preload.js`,
      contextIsolation: true,
      nodeIntegration: false,
      // 性能优化 (T-8)：禁用后台节流，避免窗口失焦时定时器/动画被限流导致卡顿。
      backgroundThrottling: false,
    },
  });

  setMainWindow(win);

  // 先显示 loading 页面
  showLoadingScreen(win);

  // ── 端口发现策略 ──
  // 1. 先读 port file，看是否已有 daemon 在跑
  // 2. 如果有 → 直接复用该端口
  // 3. 如果没有 → fork 后端（随机端口），等 port file 出现后读实际端口
  let actualPort: number | null = null;

  const existing = readPortFile();
  if (existing && existing.port > 0) {
    // port file 存在且进程活着 → 验证端口是否真的在监听
    if (await isPortAlive(existing.port, existing.host === '0.0.0.0' ? 'localhost' : existing.host)) {
      actualPort = existing.port;
      console.log(`[desktop] Reusing existing daemon on port ${actualPort}`);
    }
  }

  if (!actualPort) {
    // 没有现成服务 → fork 后端 daemon（随机端口）
    console.log('[desktop] No existing daemon found, spawning backend with random port...');
    backendProcess = spawnBackend();

    // 等待 port file 出现，获取实际端口
    actualPort = await waitForPortFile(30_000);
    if (!actualPort) {
      console.error('[desktop] Backend failed to start within 30s (no port file)');
      showErrorScreen(win);
      return;
    }

    // 额外等待端口真正可连接
    const ready = await waitForPort(actualPort, 10_000);
    if (!ready) {
      console.error(`[desktop] Port ${actualPort} found in port file but not connectable`);
      showErrorScreen(win);
      return;
    }
    console.log(`[desktop] Backend is ready on port ${actualPort}`);
  }

  // 后端就绪，加载真实页面
  await win.loadURL(`http://localhost:${actualPort}`);

  // 动态加载 electron-updater（可选依赖）
  try {
    const updaterModule = await import('electron-updater') as unknown as AutoUpdaterModule;
    await startDesktopUpdater(electron, updaterModule);
  } catch {
    // electron-updater 不可用 — 跳过自动更新
  }
}

// 当通过 electron 命令直接运行时启动桌面端
if (typeof process !== 'undefined' && (process.versions as Record<string, string | undefined>).electron) {
  // port 参数保留兼容但实际走 port file 随机端口发现
  const port = parseInt(process.env.LINGXIAO_PORT || '0', 10);
  createDesktopWindow(port).catch((err) => {
    console.error('[desktop] Failed to start:', err);
    process.exit(1);
  });
}
