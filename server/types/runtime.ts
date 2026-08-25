export interface RuntimeToolStatus {
  available: boolean;
  version?: string;
  message?: string;
}

export interface RuntimeStatus {
  ytDlp: RuntimeToolStatus;
  deno: RuntimeToolStatus;
  ejs?: RuntimeToolStatus;
  poTokenProvider?: RuntimeToolStatus;
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

export interface ConnectivityStatus {
  ok: boolean;
  code: 'OK' | import('./errors.ts').ErrorCode;
  message: string;
  recommendation?: string;
  testedAt: string;
  elapsedMs: number;
  proxyConfigured: boolean;
  cookieConfigured: boolean;
  videoTitle?: string;
}
