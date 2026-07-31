'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

function createDataBackupActions({
  loadApi,
  showSaveDialog,
  showOpenDialog,
  confirmRestore,
  restartApp,
  documentsPath,
  fileSystem = fs,
  createTempPath = (targetPath) => `${targetPath}.${randomUUID()}.tmp`,
}) {
  if (typeof loadApi !== 'function') throw new TypeError('loadApi 必须是函数');
  if (typeof showSaveDialog !== 'function') throw new TypeError('showSaveDialog 必须是函数');
  if (typeof showOpenDialog !== 'function') throw new TypeError('showOpenDialog 必须是函数');
  if (typeof confirmRestore !== 'function') throw new TypeError('confirmRestore 必须是函数');
  if (typeof restartApp !== 'function') throw new TypeError('restartApp 必须是函数');

  return {
    async saveBackup() {
      const backup = await loadApi('/api/backup');
      const exportedAt = new Date().toISOString().slice(0, 10);
      const result = await showSaveDialog({
        title: '保存本地数据备份',
        defaultPath: path.join(documentsPath, `学习资料下载器备份-${exportedAt}.json`),
        filters: [{ name: '学习资料下载器备份', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return { saved: false };

      const content = `${JSON.stringify(backup, null, 2)}\n`;
      const bytes = Buffer.byteLength(content, 'utf8');
      if (bytes > MAX_BACKUP_BYTES) {
        throw new Error('备份内容超过 20 MB 安全上限，请先清理不需要的历史记录');
      }

      const tempPath = createTempPath(result.filePath);
      try {
        await fileSystem.writeFile(tempPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await fileSystem.rename(tempPath, result.filePath);
      } catch (error) {
        try {
          await fileSystem.unlink(tempPath);
        } catch {
          // 临时文件不存在或已被 rename，忽略。
        }
        throw error;
      }

      return {
        saved: true,
        path: result.filePath,
        taskCount: Array.isArray(backup?.data?.tasks) ? backup.data.tasks.length : 0,
      };
    },

    async restoreBackup() {
      const selected = await showOpenDialog({
        title: '选择本地数据备份',
        properties: ['openFile'],
        filters: [{ name: '学习资料下载器备份', extensions: ['json'] }],
      });
      const filePath = selected.filePaths?.[0];
      if (selected.canceled || !filePath) return { restored: false };

      const stats = await fileSystem.stat(filePath);
      if (!stats.isFile()) throw new Error('选择的备份不是普通文件');
      if (stats.size <= 0) throw new Error('备份文件为空');
      if (stats.size > MAX_BACKUP_BYTES) throw new Error('备份文件超过 20 MB 安全上限');

      let backup;
      try {
        backup = JSON.parse(await fileSystem.readFile(filePath, 'utf8'));
      } catch (error) {
        if (error instanceof SyntaxError) throw new Error('备份文件不是有效的 JSON 格式');
        throw error;
      }

      const summary = await loadApi('/api/backup/inspect', {
        method: 'POST',
        body: JSON.stringify(backup),
      });
      if (!await confirmRestore({ filePath, summary })) {
        return { restored: false };
      }

      const restored = await loadApi('/api/backup/restore', {
        method: 'POST',
        body: JSON.stringify(backup),
      });
      restartApp();
      return { restored: true, restarting: true, summary: restored };
    },
  };
}

module.exports = {
  MAX_BACKUP_BYTES,
  createDataBackupActions,
};
