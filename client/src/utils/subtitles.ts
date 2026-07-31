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
