import { Router } from 'express';
import type { BackupService } from '../services/backup.service.ts';
import { AppError } from '../types/errors.ts';
import { ok } from '../types/result.ts';

export function createBackupRouter(backupService: BackupService, desktopToken: string): Router {
  const router = Router();

  router.use((req, _res, next) => {
    if (!desktopToken || req.get('x-desktop-token') !== desktopToken) {
      throw new AppError('PATH_NOT_ALLOWED', '数据备份接口仅允许桌面应用调用', undefined, 403);
    }
    next();
  });

  router.get('/', (_req, res) => {
    res.json(ok(backupService.createBackup()));
  });

  router.post('/inspect', (req, res) => {
    res.json(ok(backupService.inspectBackup(req.body)));
  });

  router.post('/restore', (req, res) => {
    res.json(ok(backupService.restoreBackup(req.body)));
  });

  return router;
}
