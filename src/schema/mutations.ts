import type { FindingItem, StatusMarker } from './types';

/**
 * Return a new FindingItem with the given status marker set.
 * The original item is not modified. Sets dirty: true.
 */
export function withStatus(
  item: FindingItem,
  marker: StatusMarker,
  resolution?: string,
): FindingItem {
  return {
    ...item,
    status: marker,
    dirty: true,
    ...(resolution !== undefined ? { resolution } : {}),
  };
}

/**
 * Return a new FindingItem with the given resolution text set.
 * The original item is not modified. Sets dirty: true.
 */
export function withResolution(item: FindingItem, text: string): FindingItem {
  return {
    ...item,
    resolution: text,
    dirty: true,
  };
}
