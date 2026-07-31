export {};

declare global {
  interface Window {
    desktop?: {
      selectDirectory: () => Promise<string | null>;
      openLogsDirectory: () => Promise<{ path: string; error?: string }>;
    };
  }
}
