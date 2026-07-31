const fs = require('node:fs');
const path = require('node:path');

const TASK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_MEDIA_EXTENSIONS = new Set(['.mp4', '.webm', '.mp3', '.m4a']);

/**
 * Build desktop-only file actions around a trusted task lookup.
 * The renderer passes only a UUID; output paths always come back from the local backend.
 */
function createDownloadActions({ loadTask, shell, fileSystem = fs }) {
  async function resolveCompletedFile(taskId) {
    if (typeof taskId !== 'string' || !TASK_ID_RE.test(taskId)) {
      throw new Error('下载任务 ID 格式无效');
    }

    const task = await loadTask(taskId);
    if (!task || task.status !== 'completed') {
      throw new Error('该任务尚未完成，不能打开下载文件');
    }
    if (typeof task.outputPath !== 'string' || !path.isAbsolute(task.outputPath)) {
      throw new Error('下载记录中的文件路径无效');
    }

    const outputPath = path.resolve(task.outputPath);
    if (!ALLOWED_MEDIA_EXTENSIONS.has(path.extname(outputPath).toLowerCase())) {
      throw new Error('该下载记录不是受支持的媒体文件，已拒绝打开');
    }
    let stats;
    try {
      stats = fileSystem.statSync(outputPath);
    } catch {
      throw new Error('文件已被移动或删除，请检查下载目录');
    }
    if (!stats.isFile()) {
      throw new Error('下载记录指向的不是文件');
    }
    return outputPath;
  }

  return Object.freeze({
    openDownload: async (taskId) => {
      try {
        const outputPath = await resolveCompletedFile(taskId);
        const error = await shell.openPath(outputPath);
        return error ? { path: outputPath, error } : { path: outputPath };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    revealDownload: async (taskId) => {
      try {
        const outputPath = await resolveCompletedFile(taskId);
        shell.showItemInFolder(outputPath);
        return { path: outputPath };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
  });
}

module.exports = { createDownloadActions };
