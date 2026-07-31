import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

export interface SensitiveFileWriteOptions {
  platform?: NodeJS.Platform;
  windowsIdentity?: string | null;
  applyWindowsAcl?: (filePath: string, identity: string) => void;
  onWarning?: (message: string, error?: unknown) => void;
}

export interface SensitiveFileProtection {
  protected: boolean;
  modeApplied: boolean;
  windowsAclApplied: boolean;
}

export function currentWindowsIdentity(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const username = env.USERNAME?.trim();
  const domain = env.USERDOMAIN?.trim();
  if (!username || /[\0\r\n]/.test(username) || (domain && /[\0\r\n]/.test(domain))) {
    return null;
  }
  return domain ? `${domain}\\${username}` : username;
}

export function buildWindowsAclArgs(filePath: string, identity: string): string[] {
  return [filePath, '/inheritance:r', '/grant:r', `${identity}:(F)`];
}

function applyWindowsAcl(filePath: string, identity: string): void {
  execFileSync('icacls.exe', buildWindowsAclArgs(filePath, identity), {
    windowsHide: true,
    stdio: 'ignore',
  });
}

/**
 * 写入必须以明文提供给外部工具的敏感文件，并尽量限制为当前系统账号可读。
 * 不使用 shell，也不会把文件内容传给权限命令或日志。
 */
export function writeSensitiveTextFileSync(
  filePath: string,
  content: string,
  options: SensitiveFileWriteOptions = {},
): SensitiveFileProtection {
  const platform = options.platform ?? process.platform;
  const warn = options.onWarning ?? ((message: string, error?: unknown) => {
    console.warn(message, error);
  });

  fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 });

  let modeApplied = false;
  try {
    fs.chmodSync(filePath, 0o600);
    modeApplied = true;
  } catch (error) {
    warn('[security] 无法应用敏感文件的仅当前用户读写模式', error);
  }

  let windowsAclApplied = platform !== 'win32';
  if (platform === 'win32') {
    const identity = options.windowsIdentity === undefined
      ? currentWindowsIdentity()
      : options.windowsIdentity;
    if (!identity) {
      warn('[security] 无法识别当前 Windows 用户，未能收紧敏感文件 ACL');
    } else {
      try {
        (options.applyWindowsAcl ?? applyWindowsAcl)(filePath, identity);
        windowsAclApplied = true;
      } catch (error) {
        warn('[security] Windows 敏感文件 ACL 加固失败', error);
      }
    }
  }

  return {
    protected: platform === 'win32' ? windowsAclApplied : modeApplied,
    modeApplied,
    windowsAclApplied,
  };
}
