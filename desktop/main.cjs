const { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { createDownloadActions } = require('./download-actions.cjs');
const {
  clearDesktopWebCaches,
  hasVersionConflict,
  normalizeAppVersion,
} = require('./release-policy.cjs');

let mainWindow = null;
let backendProcess = null;
let backendLog = null;
let shuttingDown = false;
let appOrigin = null;
let downloadActions = null;

// 固定端口可让 localStorage / Service Worker 等浏览器数据跨启动复用。
// 端口被占用时自动退回随机端口，避免应用完全无法启动。
const PREFERRED_PORT = 47831;

const appVersion = app.getVersion();
const hasSingleInstanceLock = app.requestSingleInstanceLock({ version: appVersion });
if (!hasSingleInstanceLock) {
  app.whenReady()
    .then(() => dialog.showMessageBox({
      type: 'info',
      title: '应用已经在运行',
      message: `刚刚启动的是 v${appVersion}`,
      detail: '现有窗口已被置于前台。请查看窗口顶部的版本号；如果版本不同，请先关闭现有窗口，再重新打开新版。',
      buttons: ['知道了'],
      noLink: true,
    }))
    .finally(() => app.quit());
}

app.on('second-instance', (_event, _argv, _workingDirectory, additionalData) => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();

  const incomingVersion = normalizeAppVersion(additionalData?.version);
  if (hasVersionConflict(appVersion, incomingVersion)) {
    void dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '检测到另一个应用版本',
      message: `当前运行 v${appVersion}，刚刚启动 v${incomingVersion}`,
      detail: '为避免两个版本同时读写同一份任务数据，新版本没有重复启动。请关闭当前窗口，再重新打开要使用的版本。',
      buttons: ['知道了'],
      noLink: true,
    });
  }
});

function getAvailablePort(preferredPort = PREFERRED_PORT) {
  return new Promise((resolve, reject) => {
    const tryListen = (port, allowFallback) => {
      const server = net.createServer();
      server.unref();
      server.once('error', (error) => {
        if (allowFallback && error?.code === 'EADDRINUSE') {
          tryListen(0, false);
          return;
        }
        reject(error);
      });
      server.listen(port, '127.0.0.1', () => {
        const address = server.address();
        const availablePort = typeof address === 'object' && address ? address.port : 0;
        server.close((error) => {
          if (error) reject(error);
          else resolve(availablePort);
        });
      });
    };

    tryListen(preferredPort, true);
  });
}

function waitForHealth(url, timeoutMs = 20_000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      if (!backendProcess) {
        reject(new Error('后端进程未能保持运行，请查看 logs/backend.log'));
        return;
      }
      if (backendProcess.exitCode !== null || backendProcess.signalCode !== null) {
        reject(
          new Error(
            `后端进程已退出（退出码: ${backendProcess.exitCode ?? '无'}，信号: ${backendProcess.signalCode ?? '无'}）`,
          ),
        );
        return;
      }

      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode === 200) {
          resolve();
          return;
        }
        retry();
      });
      request.setTimeout(1_000, () => request.destroy());
      request.on('error', retry);
    };

    const retry = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('后端服务启动超时'));
        return;
      }
      setTimeout(check, 250);
    };

    check();
  });
}

function startBackend(port) {
  const projectRoot = path.resolve(__dirname, '..');
  const resourceRoot = app.isPackaged ? process.resourcesPath : projectRoot;
  const serverEntry = app.isPackaged
    ? path.join(process.resourcesPath, 'server', 'index.cjs')
    : path.join(projectRoot, 'dist', 'server', 'index.cjs');
  const webDistPath = app.isPackaged
    ? path.join(process.resourcesPath, 'client')
    : path.join(projectRoot, 'dist', 'client');
  const appDataPath = app.getPath('userData');
  const downloadPath = path.join(app.getPath('downloads'), 'YouTube Learning Downloader');

  if (!fs.existsSync(serverEntry)) {
    throw new Error(`找不到后端构建文件: ${serverEntry}`);
  }
  if (!fs.existsSync(path.join(webDistPath, 'index.html'))) {
    throw new Error(`找不到前端构建文件: ${webDistPath}`);
  }

  const logsDir = path.join(appDataPath, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  backendLog = fs.createWriteStream(path.join(logsDir, 'backend.log'), { flags: 'a' });

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    PORT: String(port),
    APP_DATA_PATH: appDataPath,
    APP_RESOURCE_PATH: resourceRoot,
    WEB_DIST_PATH: webDistPath,
    DOWNLOAD_PATH: downloadPath,
  };

  const child = spawn(process.execPath, [serverEntry], {
    cwd: appDataPath,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backendProcess = child;
  child.stdout.pipe(backendLog);
  child.stderr.pipe(backendLog);
  child.on('error', (error) => backendLog?.write(`[desktop] ${error.stack}\n`));
  child.on('exit', (code, signal) => {
    backendLog?.write(
      `[desktop] backend exited (code=${code ?? 'none'}, signal=${signal ?? 'none'})\n`,
    );
    backendLog?.end();
    backendLog = null;
    if (backendProcess === child) backendProcess = null;

    // 启动阶段由 waitForHealth 统一报错，避免连续弹出两个错误框。
    if (!shuttingDown && mainWindow) {
      dialog.showErrorBox(
        '后端服务已停止',
        '应用的后台服务意外退出。详细信息请查看用户数据目录中的 logs/backend.log。',
      );
      app.quit();
    }
  });
}

function stopBackend() {
  if (!backendProcess || backendProcess.exitCode !== null) return;

  if (process.platform === 'win32' && backendProcess.pid) {
    spawnSync('taskkill', ['/PID', String(backendProcess.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } else {
    backendProcess.kill('SIGTERM');
  }
  backendProcess = null;
  backendLog?.end();
  backendLog = null;
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#f9fafb',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (targetUrl.startsWith('https://')) void shell.openExternal(targetUrl);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (appOrigin && new URL(targetUrl).origin !== appOrigin) event.preventDefault();
  });
  void mainWindow.loadURL(url);
}

function registerIpcHandlers() {
  ipcMain.handle('desktop:get-app-version', () => appVersion);

  ipcMain.handle('desktop:select-directory', async () => {
    const options = {
      title: '选择下载目录',
      defaultPath: app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle('desktop:open-logs-directory', async () => {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const error = await shell.openPath(logsDir);
    return error ? { path: logsDir, error } : { path: logsDir };
  });

  ipcMain.handle('desktop:open-download', async (_event, taskId) => {
    if (!downloadActions) return { error: '桌面文件服务尚未就绪' };
    return downloadActions.openDownload(taskId);
  });

  ipcMain.handle('desktop:reveal-download', async (_event, taskId) => {
    if (!downloadActions) return { error: '桌面文件服务尚未就绪' };
    return downloadActions.revealDownload(taskId);
  });

  ipcMain.handle('desktop:restart-app', () => {
    shuttingDown = true;
    app.relaunch();
    app.quit();
    return true;
  });
}

async function loadHistoryTask(taskId) {
  if (!appOrigin) throw new Error('本机服务尚未启动');
  const response = await fetch(`${appOrigin}/api/history/${encodeURIComponent(taskId)}`);
  const payload = await response.json();
  if (!response.ok || !payload?.success || !payload.data) {
    throw new Error(payload?.error?.message ?? `读取下载记录失败（HTTP ${response.status}）`);
  }
  return payload.data;
}

async function startDesktopApp() {
  const port = await getAvailablePort();
  if (!port) throw new Error('无法分配本地端口');

  appOrigin = `http://127.0.0.1:${port}`;
  downloadActions = createDownloadActions({ loadTask: loadHistoryTask, shell });
  startBackend(port);
  await waitForHealth(`${appOrigin}/api/health`);
  await clearDesktopWebCaches(session.defaultSession, appOrigin);
  createWindow(appOrigin);
}

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    registerIpcHandlers();
    try {
      await startDesktopApp();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox('应用启动失败', `${message}\n\n详细信息请查看用户数据目录中的 logs/backend.log。`);
      app.quit();
    }
  });

  app.on('before-quit', () => {
    shuttingDown = true;
    stopBackend();
  });

  app.on('window-all-closed', () => {
    if (!shuttingDown) app.quit();
  });
}
