export interface GentleBatchSettings {
  gentleMode: boolean;
  gentleBatchLimit: number;
}

export const SAFE_GENTLE_BATCH_LIMIT = 20;

export function getGentleBatchLimit(settings?: Partial<GentleBatchSettings>): number {
  if (settings?.gentleMode === false) return Number.POSITIVE_INFINITY;
  const configured = settings?.gentleBatchLimit;
  return typeof configured === 'number' && Number.isInteger(configured) && configured >= 1
    ? configured
    : SAFE_GENTLE_BATCH_LIMIT;
}

export function isGentleBatchAllowed(
  selectedCount: number,
  settings?: Partial<GentleBatchSettings>,
): boolean {
  return selectedCount <= getGentleBatchLimit(settings);
}
