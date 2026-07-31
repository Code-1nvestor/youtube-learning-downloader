/** 用户可在运行时修改并持久化的应用设置。 */
export interface AppSettings {
  downloadPath: string;
  maxConcurrent: number;
  namingTemplate: string;
}

export interface AppSettingsStatus extends AppSettings {
  /** 数据库不可用时设置仅在本次运行中生效。 */
  persistent: boolean;
}

export type UpdateAppSettingsInput = Partial<AppSettings>;
