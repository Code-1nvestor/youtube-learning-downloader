/** 用户可在运行时修改并持久化的应用设置。 */
export interface AppSettings {
  downloadPath: string;
  maxConcurrent: number;
  maxRetries: number;
  namingTemplate: string;
  /** yt-dlp 使用的代理地址；空字符串表示直连。 */
  proxyUrl: string;
  /** 温和下载模式总开关 */
  gentleMode: boolean;
  /** 温和模式的单任务限速（MB/s，yt-dlp 字节速率单位） */
  gentleRateLimitMbps: number;
  /** 温和模式任务间冷却时间（秒） */
  gentleCooldownSeconds: number;
  /** 温和模式单次批量任务上限 */
  gentleBatchLimit: number;
}

export interface AppSettingsStatus extends AppSettings {
  /** 数据库不可用时设置仅在本次运行中生效。 */
  persistent: boolean;
}

export type UpdateAppSettingsInput = Partial<AppSettings>;

export const DEFAULT_GENTLE_SETTINGS = {
  gentleMode: true,
  gentleRateLimitMbps: 2,
  gentleCooldownSeconds: 30,
  gentleBatchLimit: 20,
} as const;

export type GentleSettings = Pick<
  AppSettings,
  'gentleMode' | 'gentleRateLimitMbps' | 'gentleCooldownSeconds' | 'gentleBatchLimit'
>;
