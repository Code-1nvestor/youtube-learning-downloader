import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = process.env.YLD_E2E_PACKAGE_ROOT?.trim()
  ? path.resolve(process.env.YLD_E2E_PACKAGE_ROOT.trim())
  : null;
const runtimeRoot = packageRoot ? path.join(packageRoot, 'resources') : root;
const liveEnabled = process.env.YLD_E2E_LIVE === '1';
const keepArtifacts = process.env.YLD_E2E_KEEP === '1';
const cookieBrowser = process.env.YLD_E2E_COOKIE_BROWSER?.trim().toLowerCase() ?? '';
const cookieSnapshotBrowser = process.env.YLD_E2E_COOKIE_SNAPSHOT?.trim().toLowerCase() ?? '';
const testVideoId = 'YE7VzlLtp-4';
const testVideoUrl = `https://www.youtube.com/watch?v=${testVideoId}`;

if (!liveEnabled) {
  console.error('Live test skipped. Set YLD_E2E_LIVE=1 to allow a network request and temporary download.');
  process.exit(2);
}

if (cookieBrowser && !['chrome', 'edge', 'firefox', 'brave'].includes(cookieBrowser)) {
  console.error('YLD_E2E_COOKIE_BROWSER only supports chrome, edge, firefox, or brave.');
  process.exit(2);
}

if (cookieSnapshotBrowser && cookieSnapshotBrowser !== 'chrome') {
  console.error('YLD_E2E_COOKIE_SNAPSHOT currently supports only chrome.');
  process.exit(2);
}
if (cookieBrowser && cookieSnapshotBrowser) {
  console.error('Choose either YLD_E2E_COOKIE_BROWSER or YLD_E2E_COOKIE_SNAPSHOT, not both.');
  process.exit(2);
}

class LiveApiError extends Error {
  constructor(method, route, code, message) {
    super(`${method} ${route} failed: ${code} ${message}`);
    this.code = code;
  }
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'yld-e2e-'));
const downloadDir = path.join(tempDir, 'downloads');
const databasePath = path.join(tempDir, 'app.db');
const serverLogs = [];
let serverProcess;

await mkdir(downloadDir, { recursive: true });

function appendLog(chunk) {
  serverLogs.push(String(chunk));
  if (serverLogs.length > 400) serverLogs.splice(0, serverLogs.length - 400);
}

async function getAvailablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!port) throw new Error('Could not allocate a local test port');
  return port;
}

async function startServer(port) {
  const runtimeBinary = packageRoot
    ? path.join(packageRoot, '学习资料下载器.exe')
    : process.execPath;
  const serverArgs = packageRoot
    ? [
        '--experimental-sqlite',
        path.join(runtimeRoot, 'server', 'index.cjs'),
      ]
    : [
        '--experimental-sqlite',
        path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
        path.join(root, 'server', 'index.ts'),
      ];
  const child = spawn(
    runtimeBinary,
    serverArgs,
    {
      cwd: root,
      env: {
        ...process.env,
        ...(packageRoot ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        NODE_ENV: 'production',
        PORT: String(port),
        APP_DATA_PATH: tempDir,
        APP_RESOURCE_PATH: runtimeRoot,
        DOWNLOAD_PATH: downloadDir,
        DB_PATH: databasePath,
        WEB_DIST_PATH: packageRoot
          ? path.join(runtimeRoot, 'client')
          : path.join(root, 'dist', 'client'),
        YT_DLP_BINARY: path.join(runtimeRoot, 'bin', 'yt-dlp.exe'),
        DENO_BINARY: path.join(runtimeRoot, 'bin', 'deno.exe'),
        FFMPEG_BINARY: path.join(runtimeRoot, 'bin', 'ffmpeg.exe'),
        MAX_CONCURRENT: '1',
        NAMING_TEMPLATE: 'e2e/{title}.{ext}',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  child.stdout.on('data', appendLog);
  child.stderr.on('data', appendLog);
  return child;
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  const child = serverProcess;
  child.kill();
  const gracefulExit = await Promise.race([
    once(child, 'exit').then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 7_000)),
  ]);
  if (!gracefulExit && child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([
      once(child, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
  }
  serverProcess = undefined;
}

async function waitForHealth(baseUrl, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (serverProcess?.exitCode !== null) throw new Error('Backend exited before becoming healthy');
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return;
    } catch {
      // Startup races are expected while yt-dlp and ffmpeg are being checked.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Backend health check timed out');
}

async function apiRequest(baseUrl, route, init = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(90_000),
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new LiveApiError(
      init.method ?? 'GET',
      route,
      payload.error?.code ?? String(response.status),
      payload.error?.message ?? '',
    );
  }
  return payload.data;
}

async function waitForTerminalTask(baseUrl, taskId, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  const statuses = [];
  const phases = [];
  while (Date.now() < deadline) {
    const queue = await apiRequest(baseUrl, '/api/queue');
    const task = queue.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`Task disappeared from the queue: ${taskId}`);
    if (statuses.at(-1) !== task.status) statuses.push(task.status);
    if (task.phase && phases.at(-1) !== task.phase) phases.push(task.phase);
    if (['completed', 'failed', 'cancelled'].includes(task.status)) return { task, statuses, phases };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Task did not finish within ${timeoutMs}ms`);
}

try {
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = await startServer(port);
  await waitForHealth(baseUrl);
  const health = await apiRequest(baseUrl, '/api/health');
  if (!health.runtime?.deno?.available) {
    throw new Error(`Deno runtime is unavailable: ${health.runtime?.deno?.message ?? 'unknown error'}`);
  }

  if (cookieBrowser) {
    await apiRequest(baseUrl, '/api/auth/cookie/browser', {
      method: 'POST',
      body: JSON.stringify({ browser: cookieBrowser }),
    });
  }
  let cookieSource = cookieBrowser ? 'browser' : 'none';
  if (cookieSnapshotBrowser) {
    const snapshot = await apiRequest(baseUrl, '/api/auth/cookie/snapshot', {
      method: 'POST',
      body: JSON.stringify({ browser: cookieSnapshotBrowser }),
    });
    if (snapshot.source !== 'snapshot' || snapshot.validity !== 'valid') {
      throw new Error('Chrome Cookie snapshot was not activated and verified');
    }
    cookieSource = snapshot.source;
  }

  const resolved = await apiRequest(baseUrl, `/api/resolve?url=${encodeURIComponent(testVideoUrl)}`);
  const resolvedVideo = resolved.videos.find((video) => video.id === testVideoId);
  if (!resolvedVideo) throw new Error(`Resolve result did not contain ${testVideoId}`);
  if (!Array.isArray(resolvedVideo.formats) || resolvedVideo.formats.length === 0) {
    throw new Error('Resolve result did not contain real media formats');
  }
  const resolvedHeights = resolvedVideo.formats
    .map((format) => {
      const resolution = /x(\d{3,4})$/i.exec(format.resolution ?? '')?.[1];
      const label = /(\d{3,4})p/i.exec(format.qualityLabel ?? '')?.[1];
      return Number.parseInt(resolution ?? label ?? '0', 10);
    })
    .filter((height) => Number.isFinite(height) && height > 0);
  const maxResolvedHeight = resolvedHeights.length > 0 ? Math.max(...resolvedHeights) : 0;

  await apiRequest(baseUrl, '/api/settings', {
    method: 'PUT',
    body: JSON.stringify({
      downloadPath: downloadDir,
      maxConcurrent: 1,
      namingTemplate: 'e2e/{title}.{ext}',
    }),
  });

  const created = await apiRequest(baseUrl, '/api/download', {
    method: 'POST',
    body: JSON.stringify({
      tasks: [
        {
          videoId: testVideoId,
          title: 'yt-dlp-e2e-complete',
          formatId: 'worst[ext=mp4]/worst',
          container: 'mp4',
          subtitleLangs: [],
          subtitleMode: 'none',
        },
        {
          videoId: testVideoId,
          title: 'yt-dlp-e2e-cancelled',
          formatId: 'worst[ext=mp4]/worst',
          container: 'mp4',
          subtitleLangs: [],
          subtitleMode: 'none',
        },
      ],
    }),
  });
  const [completedTaskId, cancelledTaskId] = created.taskIds;
  if (!completedTaskId || !cancelledTaskId) throw new Error('Expected two task IDs');

  await apiRequest(baseUrl, `/api/queue/${cancelledTaskId}/cancel`, { method: 'POST' });
  const completedResult = await waitForTerminalTask(baseUrl, completedTaskId);
  if (completedResult.task.status !== 'completed') {
    throw new Error(`Download ended as ${completedResult.task.status}: ${completedResult.task.error ?? 'no error message'}`);
  }
  if (completedResult.task.phase !== 'completed' || completedResult.task.progress !== 100) {
    throw new Error(`Completed task progress did not close correctly: ${completedResult.task.phase ?? 'no phase'} ${completedResult.task.progress}`);
  }

  const queue = await apiRequest(baseUrl, '/api/queue');
  const cancelledTask = queue.tasks.find((task) => task.id === cancelledTaskId);
  if (cancelledTask?.status !== 'cancelled') throw new Error('Second task was not cancelled');

  await access(completedResult.task.outputPath);
  const downloadedFile = await stat(completedResult.task.outputPath);
  if (!downloadedFile.isFile() || downloadedFile.size === 0) throw new Error('Downloaded file is missing or empty');

  const historyBeforeRestart = await apiRequest(baseUrl, '/api/history?page=1&pageSize=20');
  const historyIds = new Set(historyBeforeRestart.tasks.map((task) => task.id));
  if (!historyIds.has(completedTaskId) || !historyIds.has(cancelledTaskId)) {
    throw new Error('History did not include completed and cancelled tasks');
  }

  await stopServer();
  serverProcess = await startServer(port);
  await waitForHealth(baseUrl);
  const historyAfterRestart = await apiRequest(baseUrl, '/api/history?page=1&pageSize=20');
  const restartedIds = new Set(historyAfterRestart.tasks.map((task) => task.id));
  if (!restartedIds.has(completedTaskId) || !restartedIds.has(cancelledTaskId)) {
    throw new Error('History was not preserved after backend restart');
  }

  console.log(JSON.stringify({
    ok: true,
    videoId: resolvedVideo.id,
    downloadedBytes: downloadedFile.size,
    formatCount: resolvedVideo.formats.length,
    maxResolvedHeight,
    statusSequence: completedResult.statuses,
    phaseSequence: completedResult.phases,
    finalProgress: completedResult.task.progress,
    cancelledStatus: cancelledTask.status,
    historyCountAfterRestart: historyAfterRestart.total,
    cookieSource,
    packageRoot: packageRoot ?? undefined,
    tempDir: keepArtifacts ? tempDir : undefined,
  }, null, 2));
} catch (error) {
  if (error instanceof LiveApiError) {
    console.error(JSON.stringify({
      ok: false,
      blocked: error.code === 'RATE_LIMITED',
      code: error.code,
      message: error.message,
      nextStep: error.code === 'RATE_LIMITED'
        ? '在桌面版配置 Cookie，或经用户明确许可后设置 YLD_E2E_COOKIE_BROWSER 再运行。'
        : '查看后端日志尾部并按错误码处理。',
    }, null, 2));
  } else {
    console.error(error instanceof Error ? error.stack : String(error));
  }
  console.error('--- backend log tail ---');
  console.error(serverLogs.join('').split(/\r?\n/).slice(-80).join('\n'));
  process.exitCode = 1;
} finally {
  await stopServer();
  const resolvedTemp = path.resolve(tempDir);
  const resolvedRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (!keepArtifacts && resolvedTemp.startsWith(resolvedRoot) && path.basename(resolvedTemp).startsWith('yld-e2e-')) {
    await rm(resolvedTemp, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 250,
    });
  }
}
