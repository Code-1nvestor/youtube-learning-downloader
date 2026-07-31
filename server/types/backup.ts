import type { DownloadTask } from './download.ts';
import type { AppSettings } from './settings.ts';

export const DATA_BACKUP_FORMAT = 'youtube-learning-downloader-backup';
export const DATA_BACKUP_VERSION = 1;

export interface DataBackupDocument {
  format: typeof DATA_BACKUP_FORMAT;
  version: typeof DATA_BACKUP_VERSION;
  appVersion: string;
  exportedAt: string;
  cookieIncluded: false;
  data: {
    settings: AppSettings;
    tasks: DownloadTask[];
  };
}

export interface DataBackupSummary {
  appVersion: string;
  exportedAt: string;
  taskCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  pausedCount: number;
  willPauseCount: number;
  relocatedTaskCount: number;
  cookieIncluded: false;
}

export interface DataRestoreResult extends DataBackupSummary {
  restored: true;
  restartRequired: true;
}
