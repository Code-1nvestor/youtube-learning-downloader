export interface RuntimeToolStatus {
  available: boolean;
  version?: string;
  message?: string;
}

export interface RuntimeStatus {
  ytDlp: RuntimeToolStatus;
  ffmpeg: RuntimeToolStatus;
}
