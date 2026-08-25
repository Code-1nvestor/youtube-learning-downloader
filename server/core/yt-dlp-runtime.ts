export type YoutubeAccessMode = 'pot' | 'direct';

export interface PoTokenRuntimeConfig {
  pluginPath: string;
  baseUrl: string;
  version: string;
}

export interface YoutubeRuntimeConfig {
  denoBinary?: string;
  /** Official yt-dlp-ejs package, fetched by yt-dlp only when its bundled scripts need a newer revision. */
  remoteEjs?: boolean;
  poTokenProvider?: PoTokenRuntimeConfig;
}

/**
 * Build one consistent YouTube runtime profile for metadata and media requests.
 * Keeping this in one place prevents resolve and download from seeing different formats.
 */
export function getYtDlpRuntimeArgs(
  input?: string | YoutubeRuntimeConfig,
  accessMode: YoutubeAccessMode = 'direct',
): string[] {
  const config: YoutubeRuntimeConfig = typeof input === 'string'
    ? { denoBinary: input }
    : input ?? {};
  const args: string[] = [];
  const denoBinary = config.denoBinary?.trim();
  if (denoBinary) {
    args.push('--js-runtimes', `deno:${denoBinary}`);
    if (config.remoteEjs !== false) {
      args.push('--remote-components', 'ejs:npm');
    }
  }

  if (accessMode === 'pot' && config.poTokenProvider) {
    args.push('--plugin-dirs', config.poTokenProvider.pluginPath);
    args.push('--extractor-args', 'youtube:player_client=mweb');
    args.push(
      '--extractor-args',
      `youtubepot-bgutilhttp:base_url=${config.poTokenProvider.baseUrl}`,
    );
  }
  return args;
}
