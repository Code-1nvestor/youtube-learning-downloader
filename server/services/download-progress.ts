/**
 * Pure yt-dlp output progress parser.
 *
 * The downloader can write progress to either stdout or stderr depending on
 * how its process is configured.  This module intentionally accepts only a
 * single line and does not depend on a stream, process, or task instance.
 */

import type { DownloadPhase } from '../types/download.ts';

export type DownloadProgressStage = DownloadPhase;

export interface DownloadProgress {
  stage: DownloadProgressStage;
  /** Percentage is unavailable when yt-dlp does not know the total size. */
  percent: number | undefined;
  downloadedBytes: number | undefined;
  totalBytes: number | undefined;
  /** yt-dlp's already formatted speed text, for example "2.34MiB/s". */
  speed: string | undefined;
  /** yt-dlp's already formatted ETA text, for example "00:41". */
  eta: string | undefined;
}

type JsonRecord = Record<string, unknown>;

const UNKNOWN_TEXT = new Set([
  '',
  'na',
  'n/a',
  'nan',
  'none',
  'null',
  'unknown',
  'unavailable',
  '?',
]);

const AUDIO_EXTENSIONS = /\.(?:aac|alac|flac|m4a|mka|mp3|oga|ogg|opus|wav|weba)(?:$|[?#])/i;
const COMPLETED_TEXT = /\b(?:has already been downloaded|download(?:ing)? finished|download complete)\b/i;
const MERGING_PREFIX = /^\s*\[(?:merger|ffmpegmerger)\](?:\s|$)/i;
const POST_PROCESSING_PREFIX =
  /^\s*\[(?:extractaudio|videoconvertor|videoremuxer|ffmpegextractaudio|embedsubtitle|convertthumbnail|fixup|metadata|movefiles|thumbnailsconvertor)\](?:\s|$)/i;
const DESTINATION_LINE = /^\s*\[download\]\s+destination\s*:/i;
const DOWNLOAD_PREFIX = /^\s*\[download\](?:\s|$)/i;

/**
 * Parse one yt-dlp stdout/stderr line.
 *
 * Unrelated output, malformed JSON, and values such as NA/Unknown return null
 * (or an object with undefined fields) rather than throwing.  The function is
 * deliberately exported as a small pure boundary so callers can feed lines
 * from either process channel identically.
 */
export function parseDownloadProgress(line: string): DownloadProgress | null {
  if (typeof line !== 'string') return null;

  const text = line.trim();
  if (!text) return null;

  // Explicit stage markers are useful even when no progress-template JSON is
  // emitted (and are common on stderr).
  const explicit = parseExplicitStage(text);
  if (explicit) return explicit;

  const json = parseJsonObject(text);
  if (json) {
    const parsed = parseProgressJson(json);
    if (parsed) return parsed;
  }

  // A line that advertises JSON but cannot be decoded is malformed output;
  // do not let a stray percentage in the same line trigger the text fallback.
  if (text.includes('{') || text.includes('}')) return null;

  // Older/default yt-dlp output uses a human-readable [download] line.  Keep
  // this fallback narrow so warnings such as "Downloading webpage" are not
  // reported as progress.
  return parseTextProgress(text);
}

function parseExplicitStage(text: string): DownloadProgress | null {
  if (MERGING_PREFIX.test(text)) {
    return emptyProgress('merging');
  }

  if (POST_PROCESSING_PREFIX.test(text)) {
    return emptyProgress('post-processing');
  }

  if (DESTINATION_LINE.test(text)) {
    // A Destination line is emitted immediately before a download starts.
    // Keep this as preparing even for an audio extension; the following JSON
    // progress line (with info_dict) identifies the actual media stream.
    return emptyProgress('preparing');
  }

  if (DOWNLOAD_PREFIX.test(text) && COMPLETED_TEXT.test(text)) {
    return emptyProgress('completed', 100);
  }

  return null;
}

function parseJsonObject(text: string): JsonRecord | null {
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd < jsonStart) return null;

  try {
    const candidate = text.slice(jsonStart, jsonEnd + 1);
    let value: unknown;
    try {
      value = JSON.parse(candidate);
    } catch {
      // Some yt-dlp templates place a numeric placeholder such as NA outside
      // quotes (`"total_bytes":NA`).  Quote only these known placeholders;
      // arbitrary malformed JSON must still return null below.
      const tolerantCandidate = candidate.replace(
        /(:\s*)(?:NA|N\/A|Unknown|NaN)(?=\s*[,}])/gi,
        '$1"NA"',
      );
      value = JSON.parse(tolerantCandidate);
    }
    if (!isRecord(value) || Array.isArray(value)) return null;
    return value;
  } catch {
    return null;
  }
}

function parseProgressJson(raw: JsonRecord): DownloadProgress | null {
  // A full info JSON object also contains an info_dict-like collection of
  // metadata but is not a progress line.  Require at least one progress key
  // (or an explicit status) before classifying it as normal progress.
  if (!hasProgressKeys(raw)) return null;

  const info = getInfoDict(raw);
  const parsedTotalBytes = firstNumber(raw, ['total_bytes', '_total_bytes', 'totalBytes']);
  // yt-dlp uses zero/NA when a denominator is unavailable.  A zero total is
  // not useful for a percentage and must not turn an unknown percent into 0.
  const totalBytes = parsedTotalBytes !== undefined && parsedTotalBytes > 0
    ? parsedTotalBytes
    : undefined;
  const downloadedBytes = firstNumber(raw, [
    'downloaded_bytes',
    '_downloaded_bytes',
    'downloadedBytes',
  ]);
  const rawPercent = firstValue(raw, ['percent', '_percent_str', 'percent_str']);
  const percentValue = parsePercent(rawPercent);
  const percent = totalBytes !== undefined
    ? percentValue ?? derivePercent(downloadedBytes, totalBytes)
    : undefined;
  const speed = parseTextValue(firstValue(raw, ['speed', '_speed_str', 'speed_str']));
  const eta = parseTextValue(firstValue(raw, ['eta', '_eta_str', 'eta_str']));
  const stage = inferJsonStage(raw, info, totalBytes, downloadedBytes);

  return {
    stage,
    percent,
    downloadedBytes,
    totalBytes,
    speed,
    eta,
  };
}

function parseTextProgress(text: string): DownloadProgress | null {
  if (!DOWNLOAD_PREFIX.test(text)) return null;

  const percentMatch = text.match(/(?:^|\s)(\d{1,3}(?:\.\d+)?)\s*%/);
  if (!percentMatch) return null;
  const percentValue = parsePercent(percentMatch[1]);
  if (percentValue === undefined) return null;

  const totalBytes = parseHumanSize(text);
  const downloadedBytes = deriveDownloadedBytes(percentValue, totalBytes);
  const speed = parseSpeedText(text);
  const eta = parseEtaText(text);

  return {
    stage: 'downloading-video',
    // A human-readable line with no "of <size>" has no reliable denominator.
    percent: totalBytes === undefined ? undefined : percentValue,
    downloadedBytes,
    totalBytes,
    speed,
    eta,
  };
}

function inferJsonStage(
  raw: JsonRecord,
  info: JsonRecord | undefined,
  totalBytes: number | undefined,
  downloadedBytes: number | undefined,
): DownloadProgressStage {
  const status = normalizeText(firstValue(raw, ['status', '_status', 'phase', 'stage']));
  if (status === 'preparing' || status === 'started' || status === 'starting') {
    return 'preparing';
  }

  // A JSON status is allowed to describe post-processing, but we intentionally
  // do not infer "completed" from 100%; process exit is the authoritative
  // completion signal and a merger may still follow a 100% download.
  if (status.includes('post') || status.includes('process') || status === 'postprocessing') {
    return 'post-processing';
  }
  if (status.includes('merge')) return 'merging';

  const vcodec = firstValue(info, ['vcodec']) ?? firstValue(raw, ['vcodec', 'info_dict.vcodec']);
  const acodec = firstValue(info, ['acodec']) ?? firstValue(raw, ['acodec', 'info_dict.acodec']);
  const formatId = firstValue(info, ['format_id']) ?? firstValue(raw, ['format_id', 'info_dict.format_id']);
  const vcodecState = codecState(vcodec);
  const acodecState = codecState(acodec);

  if (vcodecState === 'none' && acodecState !== 'none') return 'downloading-audio';
  if (acodecState === 'none' && vcodecState !== 'none') return 'downloading-video';
  if (vcodecState !== 'none' && acodecState !== 'none') return 'downloading-video';

  const formatText = normalizeText(formatId);
  if (AUDIO_EXTENSIONS.test(formatText) || /(?:audio|audioonly|bestaudio|^140$|^141$|^249$|^250$|^251$)/i.test(formatText)) {
    return 'downloading-audio';
  }

  // A numerical progress object without stream metadata is still a normal
  // active download. Video is the conservative default for this app.
  if (totalBytes !== undefined || downloadedBytes !== undefined || status === 'downloading') {
    return 'downloading-video';
  }
  return 'preparing';
}

function getInfoDict(raw: JsonRecord): JsonRecord | undefined {
  const nested = raw.info_dict;
  return isRecord(nested) && !Array.isArray(nested) ? nested : undefined;
}

function hasProgressKeys(raw: JsonRecord): boolean {
  const keys = [
    'percent',
    '_percent_str',
    'percent_str',
    'eta',
    '_eta_str',
    'eta_str',
    'downloaded_bytes',
    '_downloaded_bytes',
    'downloadedBytes',
    'total_bytes',
    '_total_bytes',
    'totalBytes',
    'status',
    '_status',
    'phase',
    'stage',
  ];
  return keys.some((key) => Object.prototype.hasOwnProperty.call(raw, key));
}

function firstValue(record: JsonRecord | undefined, keys: string[]): unknown {
  if (!record) return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  }
  return undefined;
}

function firstNumber(record: JsonRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = parseNonNegativeNumber(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function parseNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (UNKNOWN_TEXT.has(text.toLowerCase())) return undefined;
  if (!/^\+?\d+(?:\.\d+)?$/.test(text)) return undefined;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function parsePercent(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (UNKNOWN_TEXT.has(text.toLowerCase())) return undefined;
  const match = text.match(/^\+?(\d+(?:\.\d+)?)\s*%?$/);
  if (!match) return undefined;
  const number = Number(match[1]);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : undefined;
}

function parseTextValue(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).trim();
  return UNKNOWN_TEXT.has(text.toLowerCase()) ? undefined : text || undefined;
}

function normalizeText(value: unknown): string {
  return parseTextValue(value)?.toLowerCase() ?? '';
}

function codecState(value: unknown): 'none' | 'known' | 'unknown' {
  if (typeof value !== 'string' && typeof value !== 'number') return 'unknown';
  const text = String(value).trim().toLowerCase();
  if (text === 'none') return 'none';
  if (!text || UNKNOWN_TEXT.has(text)) return 'unknown';
  return 'known';
}

function derivePercent(downloadedBytes: number | undefined, totalBytes: number): number | undefined {
  if (downloadedBytes === undefined || totalBytes <= 0) return undefined;
  const percent = (downloadedBytes / totalBytes) * 100;
  return Number.isFinite(percent) ? Math.min(Math.max(percent, 0), 100) : undefined;
}

function deriveDownloadedBytes(percent: number, totalBytes: number | undefined): number | undefined {
  if (totalBytes === undefined) return undefined;
  return Math.round((percent / 100) * totalBytes);
}

function parseHumanSize(text: string): number | undefined {
  // Keep this tied to the conventional "of <size>" segment; unrelated sizes
  // in a filename or warning must not become a total byte count.
  const match = text.match(/\bof\s+(?:~\s*)?(\d+(?:\.\d+)?)\s*([kmgtpe]?i?b)\b/i);
  if (!match) return undefined;
  const amountText = match[1];
  const unitText = match[2];
  if (!amountText || !unitText) return undefined;
  const amount = Number(amountText);
  const unit = unitText.toLowerCase();
  const powers: Record<string, number> = {
    b: 0,
    kb: 1,
    mb: 2,
    gb: 3,
    tb: 4,
    pb: 5,
    kib: 1,
    mib: 2,
    gib: 3,
    tib: 4,
    pib: 5,
  };
  const power = powers[unit];
  if (!Number.isFinite(amount) || power === undefined) return undefined;
  const multiplier = unit.includes('i') ? 1024 ** power : 1000 ** power;
  const bytes = amount * multiplier;
  return Number.isFinite(bytes) && bytes >= 0 ? bytes : undefined;
}

function parseSpeedText(text: string): string | undefined {
  const match = text.match(/\bat\s+([~\d][^\s]*\s*(?:[kmgtpe]?i?b\/s|b\/s))\b/i);
  return parseTextValue(match?.[1]);
}

function parseEtaText(text: string): string | undefined {
  const match = text.match(/\beta\s+([^\s]+)/i);
  return parseTextValue(match?.[1]);
}

function emptyProgress(stage: DownloadProgressStage, percent?: number): DownloadProgress {
  return {
    stage,
    percent,
    downloadedBytes: undefined,
    totalBytes: undefined,
    speed: undefined,
    eta: undefined,
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}
