import type { VideoFormat } from '../api';

export type OutputContainer = 'mp4' | 'webm' | 'mp3' | 'm4a';

export interface ActualFormatChoice {
  formatId: string;
  selector: string;
  outputContainer: OutputContainer;
  label: string;
  format: VideoFormat;
}

export interface ResolutionChoice {
  value: string;
  height?: number;
  label: string;
}

export function buildActualFormatChoices(formats: VideoFormat[]): ActualFormatChoice[] {
  const seen = new Set<string>();
  const choices: ActualFormatChoice[] = [];

  for (const format of formats) {
    if (seen.has(format.formatId) || (!format.hasVideo && !format.hasAudio)) continue;
    const outputContainer = inferOutputContainer(format);
    if (!outputContainer) continue;
    seen.add(format.formatId);
    choices.push({
      formatId: format.formatId,
      selector: format.hasVideo && !format.hasAudio
        ? buildVideoAndAudioSelector(format.formatId, outputContainer)
        : format.formatId,
      outputContainer,
      label: formatChoiceLabel(format, outputContainer),
      format,
    });
  }

  return choices;
}

export function buildPresetFormatSelector(
  quality: string,
  container: string,
  formats: VideoFormat[] = [],
): string {
  if (formats.length === 0) {
    throw new Error('尚未加载实际格式，不能创建可能降画质的下载任务');
  }

  if (container === 'mp3' || container === 'm4a') {
    const audio = selectBestAudioFormat(formats, container === 'm4a' ? 'm4a' : undefined)
      ?? selectBestAudioFormat(formats);
    if (!audio) throw new Error('当前视频没有可用音频格式');
    return audio.formatId;
  }

  const height = parseQualityHeight(quality);
  const preferredContainer = container === 'webm' ? 'webm' : 'mp4';
  const actualFormat = selectBestVideoFormat(formats, height, preferredContainer)
    ?? selectBestVideoFormat(formats, height);
  if (!actualFormat) throw new Error('当前视频没有符合该画质的实际视频格式');
  return actualFormat.hasAudio
    ? actualFormat.formatId
    : buildVideoAndAudioSelector(actualFormat.formatId, preferredContainer);
}

export function buildResolutionChoices(
  formats: VideoFormat[],
  container: string,
): ResolutionChoice[] {
  const compatibleContainer = container.toLowerCase();
  const nativeVideoFormats = formats.filter(
    (format) => format.hasVideo && format.container.toLowerCase() === compatibleContainer,
  );
  const useTranscodeFallback = (compatibleContainer === 'webm' || compatibleContainer === 'mp4')
    && nativeVideoFormats.length === 0
    && formats.some((format) => format.hasVideo);
  const eligibleFormats = useTranscodeFallback
    ? formats.filter((format) => format.hasVideo)
    : nativeVideoFormats;
  const heights = new Set<number>();
  for (const format of eligibleFormats) {
    const height = formatHeight(format);
    if (height && height > 0) heights.add(height);
  }
  const sorted = [...heights].sort((a, b) => b - a);
  const max = sorted[0];
  const transcodeSuffix = useTranscodeFallback
    ? `，转码为 ${compatibleContainer === 'webm' ? 'WebM' : 'MP4'}`
    : '';
  return [
    {
      value: 'highest',
      ...(max ? { height: max } : {}),
      label: max ? `最高（${resolutionLabel(max)}${transcodeSuffix}）` : '最高（以下载引擎为准）',
    },
    ...sorted.map((height) => ({
      value: `${height}p`,
      height,
      label: `${resolutionLabel(height)}${transcodeSuffix}`,
    })),
  ];
}

function selectBestAudioFormat(
  formats: VideoFormat[],
  container?: string,
): VideoFormat | undefined {
  return formats
    .filter((format) => (
      format.hasAudio
      && !format.hasVideo
      && (!container || format.container.toLowerCase() === container)
    ))
    .sort((a, b) => (b.filesize ?? 0) - (a.filesize ?? 0))[0];
}

function selectBestVideoFormat(
  formats: VideoFormat[],
  maxHeight?: number,
  container?: string,
): VideoFormat | undefined {
  return formats
    .filter((format) => {
      if (!format.hasVideo) return false;
      if (container && format.container.toLowerCase() !== container) return false;
      const height = formatHeight(format);
      return maxHeight === undefined || height === undefined || height <= maxHeight;
    })
    .sort((a, b) => {
      const heightDiff = (formatHeight(b) ?? 0) - (formatHeight(a) ?? 0);
      if (heightDiff !== 0) return heightDiff;
      return Number(b.hasAudio) - Number(a.hasAudio);
    })[0];
}

function buildVideoAndAudioSelector(
  videoFormatId: string,
  outputContainer: OutputContainer,
): string {
  if (outputContainer === 'webm') {
    return `${videoFormatId}+bestaudio[ext=webm]/${videoFormatId}+bestaudio`;
  }
  return `${videoFormatId}+bestaudio[ext=m4a]/${videoFormatId}+bestaudio`;
}

function inferOutputContainer(format: VideoFormat): OutputContainer | null {
  const container = format.container.toLowerCase();
  if (format.hasVideo) {
    if (container === 'mp4' || container === 'webm') return container;
    return null;
  }
  if (container === 'm4a' || container === 'mp3') return container;
  return 'mp3';
}

function parseQualityHeight(quality: string): number | undefined {
  const match = /^(\d{3,4})p$/.exec(quality);
  if (!match?.[1]) return undefined;
  const height = Number.parseInt(match[1], 10);
  return Number.isFinite(height) && height > 0 ? height : undefined;
}

function formatHeight(format: VideoFormat): number | undefined {
  const resolutionMatch = /x(\d{3,4})$/i.exec(format.resolution ?? '');
  if (resolutionMatch?.[1]) return Number.parseInt(resolutionMatch[1], 10);
  const qualityMatch = /(\d{3,4})p/i.exec(format.qualityLabel);
  return qualityMatch?.[1] ? Number.parseInt(qualityMatch[1], 10) : undefined;
}

function resolutionLabel(height: number): string {
  if (height >= 4320) return `8K（${height}p）`;
  if (height >= 2160) return `4K（${height}p）`;
  if (height >= 1440) return `2K（${height}p）`;
  return `${height}p`;
}

function formatChoiceLabel(format: VideoFormat, outputContainer: OutputContainer): string {
  const streamType = format.hasVideo
    ? format.hasAudio ? '音视频' : '视频 + 自动配音频'
    : '仅音频';
  const size = format.filesize ? ` · ${formatFileSize(format.filesize)}` : '';
  const codec = format.codec ? ` · ${format.codec}` : '';
  return `${format.qualityLabel} · ${streamType} · ${outputContainer.toUpperCase()}${codec}${size} · ID ${format.formatId}`;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '未知大小';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}
