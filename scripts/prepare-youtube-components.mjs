import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const projectRoot = process.cwd();
const componentsRoot = path.resolve(projectRoot, 'resources', 'components');
const configPath = path.join(componentsRoot, 'youtube-components.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const provider = config.provider;
const providerRoot = path.join(componentsRoot, 'bgutil');
const versionsRoot = path.join(providerRoot, 'versions');
const destination = path.join(versionsRoot, provider.version);
const activePath = path.join(providerRoot, 'active.json');

if (isPrepared(destination, activePath, provider.version)) {
  console.log(`[components] PO Token Provider ${provider.version} 已通过准备检查`);
  process.exit(0);
}

fs.mkdirSync(versionsRoot, { recursive: true });
const stagingRoot = fs.mkdtempSync(path.join(componentsRoot, '.bgutil-staging-'));
const repositoryPath = path.join(stagingRoot, 'repository');
const stagedVersion = path.join(stagingRoot, provider.version);

try {
  const verifiedSource = process.env.YLD_PROVIDER_SOURCE_DIR?.trim();
  if (verifiedSource) {
    const sourcePath = path.resolve(verifiedSource);
    if (!fs.statSync(sourcePath, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`指定的 Provider 源码目录不存在：${sourcePath}`);
    }
    fs.cpSync(sourcePath, repositoryPath, { recursive: true });
  } else {
    run('git', [
      'clone', '--depth', '1', '--branch', provider.version,
      provider.repository, repositoryPath,
    ]);
  }
  const commit = run('git', ['-C', repositoryPath, 'rev-parse', 'HEAD']).trim();
  if (commit !== provider.commit) {
    throw new Error(`Provider Git 提交不匹配：期望 ${provider.commit}，得到 ${commit}`);
  }

  const pluginPath = path.join(stagingRoot, 'bgutil-ytdlp-pot-provider.zip');
  const verifiedPlugin = process.env.YLD_PROVIDER_PLUGIN_PATH?.trim();
  if (verifiedPlugin) {
    const sourcePluginPath = path.resolve(verifiedPlugin);
    if (!fs.statSync(sourcePluginPath, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`指定的 Provider 插件不存在：${sourcePluginPath}`);
    }
    fs.copyFileSync(sourcePluginPath, pluginPath);
  } else {
    await downloadFile(provider.pluginUrl, pluginPath);
  }
  const pluginSha256 = sha256(pluginPath);
  if (pluginSha256 !== provider.pluginSha256) {
    throw new Error(`Provider 插件 SHA-256 不匹配：${pluginSha256}`);
  }

  const serverPath = path.join(repositoryPath, 'server');
  runNpm(['ci'], serverPath);
  run(
    process.execPath,
    [path.join(serverPath, 'node_modules', 'typescript', 'bin', 'tsc')],
    serverPath,
  );
  const installedVersion = run(
    process.execPath,
    [path.join(serverPath, 'build', 'generate_once.js'), '--version'],
    serverPath,
  ).trim();
  if (installedVersion !== provider.version) {
    throw new Error(`Provider 运行版本不匹配：期望 ${provider.version}，得到 ${installedVersion}`);
  }
  runNpm(['prune', '--omit=dev'], serverPath);

  fs.mkdirSync(stagedVersion, { recursive: true });
  fs.cpSync(serverPath, path.join(stagedVersion, 'server'), { recursive: true });
  fs.copyFileSync(pluginPath, path.join(stagedVersion, 'bgutil-ytdlp-pot-provider.zip'));
  fs.copyFileSync(path.join(repositoryPath, 'LICENSE'), path.join(stagedVersion, 'LICENSE'));
  fs.writeFileSync(
    path.join(stagedVersion, 'component.json'),
    `${JSON.stringify({
      version: provider.version,
      commit: provider.commit,
      pluginSha256: provider.pluginSha256,
      preparedAt: new Date().toISOString(),
    }, null, 2)}\n`,
    'utf8',
  );

  if (fs.existsSync(destination)) {
    const backup = `${destination}.replaced-${Date.now()}`;
    fs.renameSync(destination, backup);
    console.warn(`[components] 旧的同版本目录已保留为 ${path.basename(backup)}`);
  }
  fs.renameSync(stagedVersion, destination);

  const active = {
    version: provider.version,
    plugin: `versions/${provider.version}/bgutil-ytdlp-pot-provider.zip`,
    server: `versions/${provider.version}/server`,
  };
  const activeTemp = `${activePath}.new`;
  fs.writeFileSync(activeTemp, `${JSON.stringify(active, null, 2)}\n`, 'utf8');
  fs.renameSync(activeTemp, activePath);
  console.log(`[components] PO Token Provider ${provider.version} 已校验并激活`);
} finally {
  fs.rmSync(stagingRoot, { recursive: true, force: true });
}

function run(command, args, cwd = projectRoot) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr).trim() : '';
    throw new Error(`组件准备命令失败：${command}${stderr ? `\n${stderr}` : ''}`);
  }
}

function runNpm(args, cwd) {
  const npmCli = process.env.npm_execpath?.trim();
  if (npmCli) return run(process.execPath, [npmCli, ...args], cwd);
  return run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, cwd);
}

async function downloadFile(url, target) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Provider 插件下载失败：HTTP ${response.status}`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(target, data, { flag: 'wx' });
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function isPrepared(versionRoot, manifestPath, version) {
  try {
    const active = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return active.version === version
      && fs.statSync(path.join(versionRoot, 'server', 'node_modules'), { throwIfNoEntry: false })?.isDirectory()
      && fs.statSync(path.join(versionRoot, 'bgutil-ytdlp-pot-provider.zip'), { throwIfNoEntry: false })?.isFile();
  } catch {
    return false;
  }
}
