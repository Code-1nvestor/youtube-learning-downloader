const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_LOG_TAIL_BYTES = 200_000;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceKnownPath(text, value, label) {
  if (typeof value !== 'string' || value.trim().length < 3) return text;
  const variants = new Set([
    value.trim().replace(/[\\/]+$/, ''),
    value.trim().replace(/\\/g, '/').replace(/[\\/]+$/, ''),
  ]);
  let output = text;
  for (const variant of variants) {
    if (variant.length < 3) continue;
    output = output.replace(new RegExp(escapeRegExp(variant), 'gi'), label);
  }
  return output;
}

/**
 * Remove local paths and common authentication material from diagnostic text.
 * This is deliberately conservative: losing part of a log line is preferable
 * to exporting a credential or a user's private directory name.
 */
function redactDiagnosticText(input, knownPaths = []) {
  let text = typeof input === 'string' ? input : String(input ?? '');
  const paths = knownPaths
    .filter((entry) => entry && typeof entry.value === 'string' && typeof entry.label === 'string')
    .sort((a, b) => b.value.length - a.value.length);

  for (const entry of paths) {
    text = replaceKnownPath(text, entry.value, entry.label);
  }

  return text
    // Catch Windows user folders not supplied by the caller.
    .replace(/[A-Za-z]:\\Users\\[^\\\r\n]+/gi, '<USER_PROFILE>')
    // A Netscape Cookie row has at least seven tab-separated fields.
    .replace(/^[^\r\n]*(?:\t[^\r\n]*){6,}$/gm, '<COOKIE_ROW_REDACTED>')
    // Redact HTTP authentication headers and JSON-like secret fields.
    .replace(/^(\s*(?:cookie|set-cookie|authorization|proxy-authorization)\s*:\s*).*$/gim, '$1<REDACTED>')
    .replace(/(["']?(?:cookie|set-cookie|authorization|proxy-authorization)["']?\s*[=:]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,}\r\n]+)/gi, '$1<REDACTED>')
    // Never export yt-dlp Cookie arguments, including browser/profile details.
    .replace(/(--cookies(?:-from-browser)?)(?:=|\s+)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1 <REDACTED>')
    // Preserve proxy scheme/host diagnostics while removing embedded credentials.
    .replace(/\b((?:https?|socks5h?):\/\/)[^@\s/]+@/gi, '$1<REDACTED>@')
    // Signed media URLs may carry short-lived authentication in the query string.
    .replace(/\b(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, '$1?<REDACTED_QUERY>');
}

function readLogTail(filePath, maxBytes = DEFAULT_LOG_TAIL_BYTES) {
  if (typeof filePath !== 'string' || !Number.isInteger(maxBytes) || maxBytes <= 0) return '';
  let descriptor;
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size === 0) return '';
    const bytesToRead = Math.min(stats.size, maxBytes);
    const offset = Math.max(stats.size - bytesToRead, 0);
    const buffer = Buffer.alloc(bytesToRead);
    descriptor = fs.openSync(filePath, 'r');
    fs.readSync(descriptor, buffer, 0, bytesToRead, offset);
    let text = buffer.toString('utf8');
    if (offset > 0) {
      const firstLineBreak = text.indexOf('\n');
      if (firstLineBreak >= 0) text = text.slice(firstLineBreak + 1);
    }
    return text;
  } catch {
    return '';
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function yesNo(value) {
  return value ? '是' : '否';
}

function safeValue(value, fallback = '未知') {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function buildDiagnosticReport({
  appVersion,
  generatedAt = new Date().toISOString(),
  platform,
  arch,
  osRelease,
  isPackaged,
  health,
  settings,
  cookie,
  update,
  logText,
  redactionPaths = [],
}) {
  const ytDlp = health?.runtime?.ytDlp;
  const deno = health?.runtime?.deno;
  const ffmpeg = health?.runtime?.ffmpeg;
  const sanitizedLog = redactDiagnosticText(logText, redactionPaths).trim();
  const cookieSource = cookie?.source === 'snapshot'
    ? 'Chrome Cookie 快照'
    : cookie?.source === 'browser'
    ? `浏览器（${safeValue(cookie.browser)}）`
    : cookie?.source === 'file'
      ? '本机 Cookie 文件'
      : '未配置';

  return [
    '学习资料下载器 - 诊断报告',
    '========================================',
    `生成时间: ${safeValue(generatedAt)}`,
    '隐私说明: 本报告不会主动包含 Cookie 内容、代理地址、下载目录或完整用户目录。发送前仍建议人工浏览一遍。',
    '',
    '[应用]',
    `版本: ${safeValue(appVersion)}`,
    `系统: ${safeValue(platform)} ${safeValue(arch)} (${safeValue(osRelease)})`,
    `正式安装包: ${yesNo(isPackaged)}`,
    '',
    '[运行环境]',
    `后端状态: ${safeValue(health?.status)}`,
    `yt-dlp 可用: ${yesNo(ytDlp?.available)}`,
    `yt-dlp 版本: ${safeValue(ytDlp?.version, ytDlp?.message ?? '未知')}`,
    `Deno 可用: ${yesNo(deno?.available)}`,
    `Deno 版本: ${safeValue(deno?.version, deno?.message ?? '未知')}`,
    `ffmpeg 可用: ${yesNo(ffmpeg?.available)}`,
    `ffmpeg 版本: ${safeValue(ffmpeg?.version, ffmpeg?.message ?? '未知')}`,
    '',
    '[设置摘要]',
    `下载目录已配置: ${yesNo(Boolean(settings?.downloadPath))}`,
    `同时下载数量: ${safeValue(settings?.maxConcurrent)}`,
    `网络失败自动重试: ${safeValue(settings?.maxRetries)} 次`,
    `代理已配置: ${yesNo(Boolean(settings?.proxyUrl))}`,
    `设置可持久化: ${yesNo(Boolean(settings?.persistent))}`,
    '',
    '[Cookie]',
    `已配置: ${yesNo(Boolean(cookie?.configured))}`,
    `来源: ${cookieSource}`,
    `快照状态: ${cookie?.source === 'snapshot' ? safeValue(cookie.validity) : '不适用'}`,
    '',
    '[yt-dlp 更新]',
    `当前版本: ${safeValue(update?.currentVersion)}`,
    `来源: ${safeValue(update?.source)}`,
    `支持应用内更新: ${yesNo(Boolean(update?.updateSupported))}`,
    `需要重启: ${yesNo(Boolean(update?.restartRequired))}`,
    '',
    `[最近后端日志 - 已脱敏，最多 ${DEFAULT_LOG_TAIL_BYTES} 字节]`,
    sanitizedLog || '(日志文件不存在或为空)',
    '',
  ].join('\n');
}

function createDiagnosticActions({
  loadApi,
  showSaveDialog,
  appVersion,
  platform,
  arch,
  osRelease,
  isPackaged,
  paths,
  now = () => new Date(),
  fileSystem = fs,
}) {
  return Object.freeze({
    saveReport: async () => {
      const [health, settings, cookie, update] = await Promise.all([
        loadApi('/api/health'),
        loadApi('/api/settings'),
        loadApi('/api/auth/cookie'),
        loadApi('/api/runtime/yt-dlp'),
      ]);
      const logText = readLogTail(paths.logFile);
      const generatedAt = now();
      const report = buildDiagnosticReport({
        appVersion,
        generatedAt: generatedAt.toISOString(),
        platform,
        arch,
        osRelease,
        isPackaged,
        health,
        settings,
        cookie,
        update,
        logText,
        redactionPaths: [
          { value: settings.downloadPath, label: '<DOWNLOAD_DIR>' },
          { value: paths.appData, label: '<APP_DATA>' },
          { value: paths.resources, label: '<APP_RESOURCES>' },
          { value: paths.home, label: '<USER_PROFILE>' },
          { value: paths.temp, label: '<TEMP_DIR>' },
          { value: paths.appRoot, label: '<APP_ROOT>' },
        ],
      });
      const defaultName = `学习资料下载器-诊断报告-${generatedAt.toISOString().slice(0, 10)}.txt`;
      const result = await showSaveDialog({
        title: '保存脱敏诊断报告',
        defaultPath: path.join(paths.documents, defaultName),
        buttonLabel: '保存诊断报告',
        filters: [{ name: '文本文件', extensions: ['txt'] }],
      });
      if (result.canceled || !result.filePath) return { saved: false };
      fileSystem.writeFileSync(result.filePath, `\uFEFF${report}`, { encoding: 'utf8', mode: 0o600 });
      return { saved: true, path: result.filePath };
    },
  });
}

module.exports = {
  DEFAULT_LOG_TAIL_BYTES,
  buildDiagnosticReport,
  createDiagnosticActions,
  readLogTail,
  redactDiagnosticText,
};
