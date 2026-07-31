import fs from 'node:fs';
import path from 'node:path';
import { runProcess, type ProcessResult, type RunProcessOptions } from '../core/process.ts';
import { tail } from '../core/utils.ts';
import { AppError } from '../types/errors.ts';
import type { YtDlpUpdateStatus } from '../types/runtime.ts';

type ProcessRunner = (
  command: string,
  args: string[],
  options?: RunProcessOptions,
) => Promise<ProcessResult>;

export interface ToolUpdateServiceOptions {
  binary: string;
  currentVersion?: string;
  appDataPath: string;
  resourcePath: string;
  runner?: ProcessRunner;
  enabled?: boolean;
}

/**
 * Updates a writable copy of yt-dlp instead of mutating Program Files/resources.
 * The next launch prefers appData/tools/yt-dlp(.exe) via resolveToolBinary().
 */
export class ToolUpdateService {
  private readonly binary: string;
  private readonly appDataPath: string;
  private readonly resourcePath: string;
  private readonly runner: ProcessRunner;
  private currentVersion?: string;
  private installedVersion?: string;
  private restartRequired = false;
  private updating = false;
  private readonly enabled: boolean;

  constructor(options: ToolUpdateServiceOptions) {
    this.binary = options.binary;
    this.currentVersion = options.currentVersion;
    this.appDataPath = path.resolve(options.appDataPath);
    this.resourcePath = path.resolve(options.resourcePath);
    this.runner = options.runner ?? runProcess;
    this.enabled = options.enabled ?? true;
  }

  getStatus(): YtDlpUpdateStatus {
    const destination = this.destinationPath();
    const absoluteBinary = path.isAbsolute(this.binary) ? path.resolve(this.binary) : null;
    const source = absoluteBinary === destination
      ? 'updated'
      : absoluteBinary && isInside(this.resourcePath, absoluteBinary)
        ? 'bundled'
        : absoluteBinary
          ? 'custom'
          : 'path';
    return {
      ...(this.currentVersion ? { currentVersion: this.currentVersion } : {}),
      ...(this.installedVersion ? { installedVersion: this.installedVersion } : {}),
      source,
      updateSupported: this.enabled && absoluteBinary !== null && fs.existsSync(absoluteBinary),
      channel: 'nightly',
      restartRequired: this.restartRequired,
      ...(!this.enabled
        ? { message: '自动更新仅在 Windows 桌面版中启用' }
        : !absoluteBinary
        ? { message: '当前使用系统 PATH 中的 yt-dlp，请通过原安装方式更新' }
        : {}),
    };
  }

  async updateYtDlp(): Promise<YtDlpUpdateStatus> {
    if (this.updating) {
      throw new AppError('INVALID_PARAM', 'yt-dlp 正在更新，请稍候');
    }
    if (!this.enabled) {
      throw new AppError('TOOL_UPDATE_FAILED', '自动更新仅在 Windows 桌面版中启用');
    }
    if (!path.isAbsolute(this.binary) || !fs.existsSync(this.binary)) {
      throw new AppError('TOOL_UPDATE_FAILED', '当前 yt-dlp 不是桌面版内置文件，无法安全自动更新');
    }

    this.updating = true;
    const toolsDir = path.resolve(this.appDataPath, 'tools');
    const destination = this.destinationPath();
    const tempPath = `${destination}.download`;
    const backupPath = `${destination}.backup`;

    try {
      fs.mkdirSync(toolsDir, { recursive: true });
      removeIfExists(tempPath);
      removeIfExists(`${tempPath}.old`);
      removeIfExists(backupPath);
      fs.copyFileSync(this.binary, tempPath);

      const updateResult = await this.runner(tempPath, ['--update-to', 'nightly'], {
        timeoutMs: 180_000,
        maxOutputBytes: 4 * 1024 * 1024,
      });
      if (updateResult.exitCode !== 0) {
        throw new AppError('TOOL_UPDATE_FAILED', 'yt-dlp 官方更新失败，请稍后重试', {
          output: tail(`${updateResult.stdout}\n${updateResult.stderr}`, 2_000),
        });
      }
      const updateOutput = `${updateResult.stdout}\n${updateResult.stderr}`;
      if (/skipping verification|unverified builds/i.test(updateOutput)) {
        throw new AppError(
          'TOOL_UPDATE_FAILED',
          '官方发布文件缺少可用校验信息，本次更新已取消',
          { output: tail(updateOutput, 2_000) },
        );
      }

      const versionResult = await this.runner(tempPath, ['--version'], {
        timeoutMs: 20_000,
        maxOutputBytes: 1024 * 1024,
      });
      const installedVersion = versionResult.stdout.trim().split(/\r?\n/, 1)[0];
      if (versionResult.exitCode !== 0 || !installedVersion) {
        throw new AppError('TOOL_UPDATE_FAILED', '更新文件校验失败：无法读取 yt-dlp 版本');
      }

      if (fs.existsSync(destination)) fs.renameSync(destination, backupPath);
      try {
        fs.renameSync(tempPath, destination);
      } catch (error) {
        if (fs.existsSync(backupPath)) fs.renameSync(backupPath, destination);
        throw error;
      }
      removeIfExists(backupPath);

      this.installedVersion = installedVersion;
      if (path.resolve(this.binary) === destination) {
        this.currentVersion = installedVersion;
        this.restartRequired = false;
      } else {
        this.restartRequired = true;
      }
      return this.getStatus();
    } catch (error) {
      removeIfExists(tempPath);
      removeIfExists(`${tempPath}.old`);
      if (error instanceof AppError) throw error;
      throw new AppError('TOOL_UPDATE_FAILED', 'yt-dlp 更新文件写入失败', {
        cause: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.updating = false;
    }
  }

  private destinationPath(): string {
    const executableName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    return path.resolve(this.appDataPath, 'tools', executableName);
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function removeIfExists(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
