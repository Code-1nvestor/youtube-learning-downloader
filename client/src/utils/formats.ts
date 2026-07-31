import type { VideoFormat } from '../api';

export type OutputContainer = 'mp4' | 'webm' | 'mp3' | 'm4a';

export interface ActualFormatChoice {
  formatId: string;
  selector: string;
  outputContainer: OutputContainer;
  label: string;
  format: VideoFormat;
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

export function buildPresetFormatSelector(quality: string, container: string): string {
  if (container === 'mp3' || container === 'm4a') return 'bestaudio/best';

  const heightMap: Record<string, number> = {
    '1080p': 1080,
    '720p': 720,
    '480p': 480,
  };
  const height = heightMap[quality];
  const heightFilter = height ? `[height<=${height}]` : '';
  if (container === 'webm') {
    return `bestvideo[ext=webm]${heightFilter}+bestaudio[ext=webm]/best[ext=webm]${heightFilter}/best`;
  }
  return `bestvideo[ext=mp4]${heightFilter}+bestaudio[ext=m4a]/best[ext=mp4]${heightFilter}/best`;
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
