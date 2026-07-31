export {};

declare global {
  interface Window {
    desktop?: {
      selectDirectory: () => Promise<string | null>;
    };
  }
}
