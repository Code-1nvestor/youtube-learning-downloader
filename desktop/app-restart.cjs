const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const RESTART_DELAY_MS = 150;

function isPathInside(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function resolveWindowsParentExecutable(parentPid, env = process.env, run = spawnSync) {
  const result = run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '(Get-CimInstance Win32_Process -Filter "ProcessId = $env:YLD_RELAUNCH_PARENT_PID").ExecutablePath',
  ], {
    encoding: 'utf8',
    env: { ...env, YLD_RELAUNCH_PARENT_PID: String(parentPid) },
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return '';
  return String(result.stdout || '').trim();
}

function createAppRestarter({
  app,
  markShuttingDown,
  env = process.env,
  platform = process.platform,
  argv = process.argv,
  execPath = process.execPath,
  parentPid = process.ppid,
  tempDir = os.tmpdir(),
  resolveParentExecutable = resolveWindowsParentExecutable,
  schedule = setTimeout,
}) {
  if (!app || typeof app.relaunch !== 'function' || typeof app.quit !== 'function') {
    throw new TypeError('app must provide relaunch() and quit()');
  }
  if (typeof markShuttingDown !== 'function') {
    throw new TypeError('markShuttingDown must be a function');
  }

  return () => {
    schedule(() => {
      markShuttingDown();
      const portableExecutable = env.PORTABLE_EXECUTABLE_FILE;
      const looksLikePortableExtraction = platform === 'win32' && isPathInside(tempDir, execPath);

      if (platform === 'win32' && (portableExecutable || looksLikePortableExtraction)) {
        const originalExecutable = portableExecutable || resolveParentExecutable(parentPid, env);
        if (originalExecutable) {
          app.relaunch({ execPath: originalExecutable, args: argv.slice(1) });
        } else {
          app.relaunch();
        }
      } else {
        app.relaunch();
      }

      app.quit();
    }, RESTART_DELAY_MS);
  };
}

module.exports = {
  RESTART_DELAY_MS,
  createAppRestarter,
  isPathInside,
  resolveWindowsParentExecutable,
};
