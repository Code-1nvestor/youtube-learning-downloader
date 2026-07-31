export type SubtitleMode = 'none' | 'embed' | 'separate';

export function parseSubtitleLanguages(mode: SubtitleMode, input: string): string[] {
  if (mode === 'none') return [];

  return Array.from(
    new Set(
      input
        .split(',')
        .map((language) => language.trim())
        .filter(Boolean),
    ),
  );
}

export function buildSubtitleFileName(title: string, language: string): string {
  const safeTitle = sanitizeFilePart(title) || 'subtitle';
  const safeLanguage = sanitizeFilePart(language) || 'unknown';
  return `${safeTitle}.${safeLanguage}.srt`;
}

function sanitizeFilePart(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120);
}
