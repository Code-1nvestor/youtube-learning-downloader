const APP_WEB_CACHE_STORAGES = Object.freeze(['serviceworkers', 'cachestorage']);

function normalizeAppVersion(value) {
  if (typeof value !== 'string') return null;
  const version = value.trim();
  if (version.length === 0 || version.length > 64) return null;
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version) ? version : null;
}

function hasVersionConflict(currentVersion, incomingVersion) {
  const current = normalizeAppVersion(currentVersion);
  const incoming = normalizeAppVersion(incomingVersion);
  return Boolean(current && incoming && current !== incoming);
}

function normalizeLoopbackOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new Error('桌面网页缓存地址无效');
  }

  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (url.protocol !== 'http:' || !loopbackHosts.has(url.hostname) || url.username || url.password) {
    throw new Error('桌面网页缓存只能清理本机 HTTP 地址');
  }
  return url.origin;
}

async function clearDesktopWebCaches(electronSession, origin) {
  if (!electronSession || typeof electronSession.clearStorageData !== 'function') {
    throw new Error('Electron 会话不可用，无法刷新桌面网页缓存');
  }

  const safeOrigin = normalizeLoopbackOrigin(origin);
  await electronSession.clearStorageData({
    origin: safeOrigin,
    storages: [...APP_WEB_CACHE_STORAGES],
  });
}

module.exports = {
  APP_WEB_CACHE_STORAGES,
  clearDesktopWebCaches,
  hasVersionConflict,
  normalizeAppVersion,
  normalizeLoopbackOrigin,
};
