const { app, BrowserWindow, dialog, ipcMain, Menu, Notification, session, shell } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { createDownloadActions } = require('./download-actions.cjs');
const {
  createDiagnosticActions,
} = require('./diagnostics.cjs');
const {
  clearDesktopWebCaches,
  hasVersionConflict,
  normalizeAppVersion,
} = require('./release-policy.cjs');
const { createCloseGuard, formatActiveTaskSummary } = require('./close-guard.cjs');
const { createTaskMonitor } = require('./task-monitor.cjs');
const { createDataBackupActions } = require('./data-backup.cjs');
const { createAppRestarter } = require('./app-restart.cjs');

let mainWindow = null;
let backendProcess = null;
let backendLog = null;
let shuttingDown = false;
let appOrigin = null;
let downloadActions = null;
let taskMonitor = null;
const activeNotifications = new Set();

// 固定端口可让 localStorage / Service Worker 等浏览器数据跨启动复用。
// 端口被占用时自动退回随机端口，避免应用完全无法启动。
const PREFERRED_PORT = 47831;

const appVersion = app.getVersion();
const desktopApiToken = randomBytes(32).toString('hex');
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
    APP_VERSION: appVersion,
    DESKTOP_API_TOKEN: desktopApiToken,
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
  const window = new BrowserWindow({
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
  mainWindow = window;

  const closeGuard = createCloseGuard({
    loadQueueStatus: () => loadLocalApiData('/api/queue'),
    confirmClose: async ({ statusKnown, summary }) => {
      const result = await dialog.showMessageBox(window, {
        type: 'warning',
        title: statusKnown ? '下载任务仍在进行' : '暂时无法确认下载状态',
        message: statusKnown
          ? `还有 ${summary.total} 个任务尚未结束`
          : '应用暂时无法读取下载队列状态',
        detail: statusKnown
          ? `${formatActiveTaskSummary(summary)}。\n\n退出会停止当前下载；下载中的任务会保留断点，下次启动后可继续。`
          : '直接退出可能会中断正在进行的下载。建议返回应用确认队列状态；如果确定要退出，也可以继续。',
        buttons: ['继续下载', '退出应用'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    },
    approveClose: () => window.close(),
    onError: (error) => console.error('[desktop] 关闭保护检查失败:', error),
  });

  window.once('ready-to-show', () => window.show());
  window.on('close', (event) => {
    if (!shuttingDown) closeGuard.handleClose(event);
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (targetUrl.startsWith('https://')) void shell.openExternal(targetUrl);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (appOrigin && new URL(targetUrl).origin !== appOrigin) event.preventDefault();
  });
  void window.loadURL(url);
}

function updateTaskbar(progress) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setProgressBar(progress.value, { mode: progress.mode });
}

function showDesktopNotification({ title, body }) {
  if (!Notification.isSupported()) return;

  const notification = new Notification({
    title,
    body,
    icon: path.join(__dirname, 'icon.ico'),
    timeoutType: 'default',
  });
  const release = () => activeNotifications.delete(notification);
  activeNotifications.add(notification);
  notification.once('close', release);
  notification.once('failed', (_event, error) => {
    release();
    console.error('[desktop] 系统通知显示失败', error);
  });
  notification.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  notification.show();
}

function startTaskMonitor() {
  taskMonitor?.stop();
  taskMonitor = createTaskMonitor({
    loadQueueStatus: () => loadLocalApiData('/api/queue'),
    updateTaskbar,
    showNotification: showDesktopNotification,
    shouldNotify: () => Boolean(
      mainWindow
      && !mainWindow.isDestroyed()
      && !mainWindow.isFocused()
    ),
    onError: (error) => console.error('[desktop] 后台队列监控失败', error),
  });
  taskMonitor.start();
}

function registerIpcHandlers() {
  const appDataPath = app.getPath('userData');
  const diagnosticActions = createDiagnosticActions({
    loadApi: loadLocalApiData,
    showSaveDialog: (options) => (
      mainWindow ? dialog.showSaveDialog(mainWindow, options) : dialog.showSaveDialog(options)
    ),
    appVersion,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    isPackaged: app.isPackaged,
    paths: {
      appData: appDataPath,
      resources: process.resourcesPath,
      home: app.getPath('home'),
      temp: app.getPath('temp'),
      appRoot: path.resolve(__dirname, '..'),
      documents: app.getPath('documents'),
      logFile: path.join(appDataPath, 'logs', 'backend.log'),
    },
  });
  const restartApp = createAppRestarter({
    app,
    markShuttingDown: () => {
      shuttingDown = true;
    },
  });
  const dataBackupActions = createDataBackupActions({
    loadApi: loadLocalApiData,
    showSaveDialog: (options) => (
      mainWindow ? dialog.showSaveDialog(mainWindow, options) : dialog.showSaveDialog(options)
    ),
    showOpenDialog: (options) => (
      mainWindow ? dialog.showOpenDialog(mainWindow, options) : dialog.showOpenDialog(options)
    ),
    confirmRestore: async ({ filePath, summary }) => {
      const options = {
        type: 'warning',
        title: '恢复本地数据备份',
        message: `将用这份备份替换当前的 ${summary.taskCount} 条任务与历史记录`,
        detail: [
          `文件：${path.basename(filePath)}`,
          `备份版本：${summary.appVersion}`,
          `导出时间：${new Date(summary.exportedAt).toLocaleString('zh-CN')}`,
          `完成 ${summary.completedCount} 条，失败 ${summary.failedCount} 条，取消 ${summary.cancelledCount} 条，暂停 ${summary.pausedCount} 条`,
          summary.willPauseCount > 0
            ? `为防止意外下载，另有 ${summary.willPauseCount} 条原运行任务将恢复为“已暂停”。`
            : '备份中没有需要转为暂停的运行任务。',
          summary.relocatedTaskCount > 0
            ? `${summary.relocatedTaskCount} 条可重试任务的旧路径不在当前下载目录，将迁移到“已恢复任务”子目录。`
            : '可重试任务的保存路径均在当前安全下载目录内。',
          '',
          '当前任务、历史和普通设置将被替换，应用随后自动重启。Cookie 和已下载媒体文件不会被导入或删除。',
        ].join('\n'),
        buttons: ['取消', '确认恢复并重启'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      };
      const result = mainWindow
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options);
      return result.response === 1;
    },
    restartApp,
    documentsPath: app.getPath('documents'),
  });

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

  ipcMain.handle('desktop:save-diagnostic-report', async () => {
    return diagnosticActions.saveReport();
  });

  ipcMain.handle('desktop:save-data-backup', async () => {
    return dataBackupActions.saveBackup();
  });

  ipcMain.handle('desktop:restore-data-backup', async () => {
    return dataBackupActions.restoreBackup();
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

async function loadLocalApiData(route, init = {}) {
  if (!appOrigin) throw new Error('本机服务尚未启动');
  const headers = { ...(init.headers ?? {}) };
  if (route.startsWith('/api/backup')) headers['x-desktop-token'] = desktopApiToken;
  if (init.body && !headers['content-type']) headers['content-type'] = 'application/json';
  const response = await fetch(`${appOrigin}${route}`, { ...init, headers });
  const payload = await response.json();
  if (!response.ok || !payload?.success || payload.data === undefined) {
    throw new Error(payload?.error?.message ?? `读取诊断信息失败（HTTP ${response.status}）`);
  }
  return payload.data;
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
  startTaskMonitor();
}

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.local.youtubelearningdownloader');
    }
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
    taskMonitor?.stop();
    taskMonitor = null;
    activeNotifications.clear();
    stopBackend();
  });

  app.on('window-all-closed', () => {
    if (!shuttingDown) app.quit();
  });
}
