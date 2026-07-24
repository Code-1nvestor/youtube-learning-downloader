/**
 * process.ts — 通用子进程执行器
 *
 * 职责：安全地执行外部 CLI（yt-dlp / ffmpeg），统一处理：
 * - 超时控制（防止子进程挂死拖垮服务）
 * - 输出体积上限（防止大播放列表 JSON 撑爆内存）
 * - 二进制缺失检测（ENOENT → 友好错误）
 *
 * 设计决策：
 * - 使用 spawn 而非 exec：流式收集输出，无 shell 注入风险（参数数组传递）。
 * - 非零退出码不直接 throw，而是返回 ProcessResult 由调用方判断 ——
 *   因为 yt-dlp 的错误细节在 stderr 里，需要服务层翻译为领域错误。
 *
 * 扩展点：若未来需要实时进度（下载场景），可增加 onStdoutLine 回调参数。
 */

import { spawn } from 'node:child_process';
import { AppError } from '../types/errors.ts';

export interface RunProcessOptions {
  /** 超时毫秒数，默认 60s */
  timeoutMs?: number;
  /** stdout/stderr 各自的最大字节数，默认 64MB（大播放列表 JSON 可能很大） */
  maxOutputBytes?: number;
  /** 子进程工作目录 */
  cwd?: string;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** 执行耗时（毫秒），用于日志与性能观察 */
  durationMs: number;
}

/** 二进制不存在时抛出（调用方翻译为 YT_DLP_MISSING / FFMPEG_MISSING） */
export class BinaryNotFoundError extends Error {
  constructor(public readonly binary: string) {
    super(`找不到可执行文件: ${binary}`);
    this.name = 'BinaryNotFoundError';
  }
}

/**
 * 执行外部命令并收集全部输出。
 *
 * @throws {BinaryNotFoundError} 命令不存在
 * @throws {AppError} TIMEOUT —— 超时会先 SIGTERM，1s 后 SIGKILL
 * @returns 进程结束后的完整输出（不抛非零退出码）
 */
export async function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions = {},
): Promise<ProcessResult> {
  const { timeoutMs = 60_000, maxOutputBytes = 64 * 1024 * 1024, cwd } = options;
  const startedAt = Date.now();

  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      // 不使用 shell：避免参数被二次解析导致注入风险
      shell: false,
      windowsHide: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    // 超时控制：先温和终止，再给 1 秒宽限后强杀
    const killTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 1_000).unref();
      reject(
        new AppError('TIMEOUT', `命令执行超时（${timeoutMs}ms）: ${command}`, {
          args,
        }),
      );
    }, timeoutMs);
    // 不让定时器阻止 Node 进程退出
    killTimer.unref();

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      // 超出上限则截断保留头部（JSON 会损坏，调用方解析失败时能看到截断提示）
      if (stdoutBytes <= maxOutputBytes) stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= maxOutputBytes) stderrChunks.push(chunk);
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      if (err.code === 'ENOENT') {
        reject(new BinaryNotFoundError(command));
      } else {
        reject(
          new AppError('UNKNOWN', `无法启动子进程: ${err.message}`, { command }),
        );
      }
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code ?? -1,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}
