import fs from 'node:fs';
import path from 'node:path';

/** Prefer bundled tools for desktop builds, then fall back to PATH. */
export function resolveToolBinary(
  toolName: 'yt-dlp' | 'ffmpeg',
  configured: string | undefined,
  baseDir = process.cwd(),
): string {
  if (configured && path.isAbsolute(configured) && fs.existsSync(configured)) {
    return configured;
  }

  const executableName = process.platform === 'win32' ? `${toolName}.exe` : toolName;
  const candidates = [
    path.resolve(baseDir, 'bin', executableName),
    path.resolve(baseDir, 'resources', 'bin', executableName),
  ];
  const bundledPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (bundledPath) return bundledPath;

  return configured || toolName;
}
