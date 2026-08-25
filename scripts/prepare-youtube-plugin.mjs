import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import unzipper from 'unzipper';

const projectRoot = process.cwd();
const componentsRoot = path.resolve(projectRoot, 'resources', 'components');
const config = JSON.parse(fs.readFileSync(
  path.join(componentsRoot, 'youtube-components.json'),
  'utf8',
));
const provider = config.provider;
const providerRoot = path.join(componentsRoot, 'bgutil');
const versionRoot = path.join(providerRoot, 'versions', provider.version);
const archivePath = path.join(versionRoot, 'bgutil-ytdlp-pot-provider.zip');
const pluginRoot = path.join(versionRoot, 'plugin');
const activePath = path.join(providerRoot, 'active.json');
const expectedEntry = path.join(
  pluginRoot,
  'yt_dlp_plugins',
  'extractor',
  'getpot_bgutil_http.py',
);

if (sha256(archivePath) !== provider.pluginSha256) {
  throw new Error('Provider 插件归档 SHA-256 不匹配，拒绝展开');
}

if (!fs.statSync(expectedEntry, { throwIfNoEntry: false })?.isFile()) {
  const archive = await unzipper.Open.file(archivePath);
  for (const entry of archive.files) {
    const normalized = entry.path.replaceAll('\\', '/');
    if (normalized.startsWith('/')
      || normalized.split('/').includes('..')
      || !normalized.startsWith('yt_dlp_plugins/')) {
      throw new Error(`Provider 插件归档包含非法路径：${entry.path}`);
    }
  }

  const stagingRoot = path.join(versionRoot, `.plugin-staging-${process.pid}-${Date.now()}`);
  fs.mkdirSync(stagingRoot, { recursive: true });
  try {
    await archive.extract({ path: stagingRoot });
    const stagedEntry = path.join(
      stagingRoot,
      'yt_dlp_plugins',
      'extractor',
      'getpot_bgutil_http.py',
    );
    if (!fs.statSync(stagedEntry, { throwIfNoEntry: false })?.isFile()) {
      throw new Error('Provider 插件归档缺少 HTTP Provider 入口');
    }
    if (fs.existsSync(pluginRoot)) {
      fs.renameSync(pluginRoot, `${pluginRoot}.replaced-${Date.now()}`);
    }
    fs.renameSync(stagingRoot, pluginRoot);
  } finally {
    if (fs.existsSync(stagingRoot)) fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

const active = JSON.parse(fs.readFileSync(activePath, 'utf8'));
if (active.version !== provider.version) {
  throw new Error(`Provider 激活版本不匹配：${String(active.version)}`);
}
active.plugin = `versions/${provider.version}`;
const activeTemp = `${activePath}.new`;
fs.writeFileSync(activeTemp, `${JSON.stringify(active, null, 2)}\n`, 'utf8');
fs.renameSync(activeTemp, activePath);
console.log(`[components] yt-dlp Provider 插件 ${provider.version} 已校验并展开`);

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
