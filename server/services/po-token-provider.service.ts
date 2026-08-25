import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { PoTokenRuntimeConfig } from '../core/yt-dlp-runtime.ts';

interface ActiveProviderManifest {
  version: string;
  plugin: string;
  server: string;
}

export interface PoTokenProviderStatus {
  available: boolean;
  version?: string;
  source: 'updated' | 'bundled' | 'external' | 'missing';
  message?: string;
  baseUrl?: string;
}

interface ProviderComponent {
  version: string;
  pluginPath: string;
  serverPath: string;
  source: 'updated' | 'bundled';
}

type ProviderSpawner = (
  command: string,
  args: string[],
  options: { cwd: string; windowsHide: boolean; stdio: ['ignore', 'pipe', 'pipe'] },
) => ChildProcess;

export interface PoTokenProviderServiceOptions {
  /** Node-compatible runtime. Packaged Electron already runs the backend in Node mode. */
  runtimeBinary?: string;
  appDataPath: string;
  resourcePath: string;
  preferredPort?: number;
  startupTimeoutMs?: number;
  spawnProvider?: ProviderSpawner;
  allocatePort?: (preferredPort: number) => Promise<number>;
  ping?: (baseUrl: string) => Promise<{ ok: boolean; version?: string }>;
}

/** Owns the loopback-only provider process and exposes an immutable runtime profile. */
export class PoTokenProviderService {
  private readonly options: PoTokenProviderServiceOptions;
  private child?: ChildProcess;
  private runtime?: PoTokenRuntimeConfig;
  private status: PoTokenProviderStatus = {
    available: false,
    source: 'missing',
    message: 'PO Token Provider 组件尚未安装',
  };
  private logTail = '';

  constructor(options: PoTokenProviderServiceOptions) {
    this.options = options;
  }

  getStatus(): PoTokenProviderStatus {
    return { ...this.status };
  }

  getRuntimeConfig(): PoTokenRuntimeConfig | undefined {
    return this.runtime ? { ...this.runtime } : undefined;
  }

  async start(): Promise<PoTokenProviderStatus> {
    if (this.runtime) return this.getStatus();
    const component = resolveProviderComponent(
      this.options.appDataPath,
      this.options.resourcePath,
    );
    if (!component) return this.getStatus();

    const allocatePort = this.options.allocatePort ?? allocateLoopbackPort;
    const ping = this.options.ping ?? pingProvider;
    const spawnProvider = this.options.spawnProvider ?? spawn;
    const port = await allocatePort(this.options.preferredPort ?? 4416);
    const baseUrl = `http://127.0.0.1:${port}`;
    const nodeModulesPath = path.join(component.serverPath, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
      this.status = {
        available: false,
        source: component.source,
        version: component.version,
        message: 'Provider 依赖不完整，请重新准备组件后再启动',
      };
      return this.getStatus();
    }

    const entryPath = path.join(component.serverPath, 'build', 'main.js');
    if (!fs.existsSync(entryPath)) {
      this.status = {
        available: false,
        source: component.source,
        version: component.version,
        message: 'Provider 构建产物不完整，请重新准备组件后再启动',
      };
      return this.getStatus();
    }
    // Commander auto-detects packaged Electron and otherwise treats the script path
    // as a user argument. Mark the embedded runtime as a default Electron app before
    // loading the provider so it applies normal Node argv slicing.
    const args = [
      '--import',
      'data:text/javascript,process.defaultApp=true',
      entryPath,
      '--port',
      String(port),
    ];
    try {
      this.logTail = '';
      const child = spawnProvider(this.options.runtimeBinary ?? process.execPath, args, {
        cwd: component.serverPath,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.child = child;
      child.stdout?.on('data', (chunk: Buffer | string) => this.captureLog(chunk));
      child.stderr?.on('data', (chunk: Buffer | string) => this.captureLog(chunk));
      child.once('exit', () => {
        if (this.child !== child) return;
        this.child = undefined;
        this.runtime = undefined;
        this.status = {
          available: false,
          source: component.source,
          version: component.version,
          message: `PO Token Provider 已停止${this.logTail ? `：${this.logTail}` : ''}`,
        };
      });

      const deadline = Date.now() + (this.options.startupTimeoutMs ?? 15_000);
      let response: { ok: boolean; version?: string } = { ok: false };
      while (Date.now() < deadline && child.exitCode === null) {
        response = await ping(baseUrl).catch(() => ({ ok: false }));
        if (response.ok) break;
        await delay(150);
      }
      if (!response.ok) {
        child.kill();
        this.child = undefined;
        this.status = {
          available: false,
          source: component.source,
          version: component.version,
          message: `PO Token Provider 启动失败${this.logTail ? `：${this.logTail}` : ''}`,
        };
        return this.getStatus();
      }

      const version = response.version ?? component.version;
      this.runtime = { pluginPath: component.pluginPath, baseUrl, version };
      this.status = {
        available: true,
        source: component.source,
        version,
        baseUrl,
        message: '匿名 mweb + PO Token 已启用；Cookie 仅在受限内容需要时使用',
      };
      return this.getStatus();
    } catch (error) {
      this.child = undefined;
      this.runtime = undefined;
      this.status = {
        available: false,
        source: component.source,
        version: component.version,
        message: error instanceof Error ? error.message : 'PO Token Provider 启动失败',
      };
      return this.getStatus();
    }
  }

  stop(): void {
    const child = this.child;
    this.child = undefined;
    this.runtime = undefined;
    if (child && child.exitCode === null) child.kill();
  }

  private captureLog(chunk: Buffer | string): void {
    const next = `${this.logTail}${String(chunk)}`.replace(/[\r\n]+/g, ' ').trim();
    this.logTail = next.slice(-1_000);
  }
}

function resolveProviderComponent(
  appDataPath: string,
  resourcePath: string,
): ProviderComponent | undefined {
  const roots: Array<{ root: string; source: ProviderComponent['source'] }> = [
    { root: path.resolve(appDataPath, 'components', 'bgutil'), source: 'updated' },
    { root: path.resolve(resourcePath, 'components', 'bgutil'), source: 'bundled' },
    { root: path.resolve(resourcePath, 'resources', 'components', 'bgutil'), source: 'bundled' },
  ];
  for (const candidate of roots) {
    const manifestPath = path.join(candidate.root, 'active.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ActiveProviderManifest;
      if (!manifest.version || !manifest.plugin || !manifest.server) continue;
      const pluginPath = resolveInside(candidate.root, manifest.plugin);
      const serverPath = resolveInside(candidate.root, manifest.server);
      if (!pluginPath || !serverPath) continue;
      if (!fs.statSync(pluginPath, { throwIfNoEntry: false })?.isDirectory()) continue;
      if (!fs.statSync(serverPath, { throwIfNoEntry: false })?.isDirectory()) continue;
      return {
        version: manifest.version,
        pluginPath,
        serverPath,
        source: candidate.source,
      };
    } catch {
      // Invalid or half-written manifests are ignored; the previous root remains untouched.
    }
  }
  return undefined;
}

function resolveInside(root: string, relativePath: string): string | undefined {
  if (path.isAbsolute(relativePath)) return undefined;
  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(absoluteRoot, relativePath);
  const relative = path.relative(absoluteRoot, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return undefined;
  }
  return candidate;
}

async function allocateLoopbackPort(preferredPort: number): Promise<number> {
  const tryListen = (port: number): Promise<number> => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      const address = server.address();
      const selected = typeof address === 'object' && address ? address.port : port;
      server.close((error) => error ? reject(error) : resolve(selected));
    });
  });
  try {
    return await tryListen(preferredPort);
  } catch {
    return tryListen(0);
  }
}

async function pingProvider(baseUrl: string): Promise<{ ok: boolean; version?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_000);
  try {
    const response = await fetch(`${baseUrl}/ping`, { signal: controller.signal });
    if (!response.ok) return { ok: false };
    const payload = await response.json() as { version?: unknown };
    return {
      ok: true,
      ...(typeof payload.version === 'string' ? { version: payload.version } : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
