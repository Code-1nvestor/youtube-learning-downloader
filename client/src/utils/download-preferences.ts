import type { OutputContainer } from './formats';

export type DownloadFormatMode = 'preset' | 'actual';
export type DownloadSubtitleMode = 'none' | 'embed' | 'separate';

export interface DownloadPreferences {
  container: OutputContainer;
  quality: string;
  formatMode: DownloadFormatMode;
  subtitleMode: DownloadSubtitleMode;
  subtitleLangs: string;
  autoSubtitle: boolean;
}

export interface DownloadUiState {
  preferences: DownloadPreferences;
  actualFormatIds: Record<string, string>;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = 'yld.download-ui.v1';
const CONTAINERS = new Set<OutputContainer>(['mp4', 'webm', 'mp3', 'm4a']);
const FORMAT_MODES = new Set<DownloadFormatMode>(['preset', 'actual']);
const SUBTITLE_MODES = new Set<DownloadSubtitleMode>(['none', 'embed', 'separate']);

export const DEFAULT_DOWNLOAD_PREFERENCES: DownloadPreferences = {
  container: 'mp4',
  quality: 'highest',
  formatMode: 'preset',
  subtitleMode: 'none',
  subtitleLangs: 'zh-Hans,en',
  autoSubtitle: false,
};

export function loadDownloadUiState(storage = browserStorage()): DownloadUiState {
  if (!storage) return emptyState();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const saved = JSON.parse(raw) as {
      preferences?: Partial<DownloadPreferences>;
      actualFormatIds?: Record<string, unknown>;
    };
    return {
      preferences: sanitizePreferences(saved.preferences),
      actualFormatIds: sanitizeActualFormatIds(saved.actualFormatIds),
    };
  } catch {
    return emptyState();
  }
}

export function saveDownloadUiState(state: DownloadUiState, storage = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      preferences: sanitizePreferences(state.preferences),
      actualFormatIds: sanitizeActualFormatIds(state.actualFormatIds),
    }));
  } catch {
    // UI preference persistence is best-effort and must never block downloads.
  }
}

function emptyState(): DownloadUiState {
  return {
    preferences: { ...DEFAULT_DOWNLOAD_PREFERENCES },
    actualFormatIds: {},
  };
}

function sanitizePreferences(value: Partial<DownloadPreferences> | undefined): DownloadPreferences {
  const container = value?.container && CONTAINERS.has(value.container)
    ? value.container
    : DEFAULT_DOWNLOAD_PREFERENCES.container;
  const formatMode = value?.formatMode && FORMAT_MODES.has(value.formatMode)
    ? value.formatMode
    : DEFAULT_DOWNLOAD_PREFERENCES.formatMode;
  const subtitleMode = value?.subtitleMode && SUBTITLE_MODES.has(value.subtitleMode)
    ? value.subtitleMode
    : DEFAULT_DOWNLOAD_PREFERENCES.subtitleMode;
  const quality = typeof value?.quality === 'string' && /^(highest|\d{3,4}p)$/.test(value.quality)
    ? value.quality
    : DEFAULT_DOWNLOAD_PREFERENCES.quality;
  const subtitleLangs = typeof value?.subtitleLangs === 'string'
    ? value.subtitleLangs.slice(0, 500)
    : DEFAULT_DOWNLOAD_PREFERENCES.subtitleLangs;

  return {
    container,
    quality,
    formatMode,
    subtitleMode,
    subtitleLangs,
    autoSubtitle: value?.autoSubtitle === true,
  };
}

function sanitizeActualFormatIds(value: Record<string, unknown> | undefined): Record<string, string> {
  if (!value) return {};
  const result: Record<string, string> = {};
  for (const [videoId, formatId] of Object.entries(value)) {
    if (
      /^[A-Za-z0-9_-]{1,128}$/.test(videoId)
      && typeof formatId === 'string'
      && formatId.length > 0
      && formatId.length <= 256
    ) {
      result[videoId] = formatId;
    }
  }
  return result;
}

function browserStorage(): StorageLike | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
