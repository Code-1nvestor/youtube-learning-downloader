export interface RuntimeToolStatus {
  available: boolean;
  version?: string;
  message?: string;
}

export interface RuntimeStatus {
  ytDlp: RuntimeToolStatus;
  ffmpeg: RuntimeToolStatus;
}

export interface YtDlpUpdateStatus {
  currentVersion?: string;
  installedVersion?: string;
  source: 'updated' | 'bundled' | 'custom' | 'path';
  updateSupported: boolean;
  channel: 'nightly';
  restartRequired: boolean;
  message?: string;
}
