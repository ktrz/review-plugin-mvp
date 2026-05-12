import type { FindingItem } from './types';

/**
 * Return a new FindingItem with status 'resolved' and the given resolution.
 * Resolution is required for resolved status.
 * Original item is not modified; sets dirty: true.
 */
export function markResolved(item: FindingItem, resolution: string): FindingItem {
  return { ...item, status: 'resolved', resolution, dirty: true, options: [...item.options], reportedBy: [...item.reportedBy] };
}

/**
 * Return a new FindingItem with status 'custom' (approved with edits) and the given resolution.
 * Original item is not modified; sets dirty: true.
 */
export function markCustom(item: FindingItem, resolution: string): FindingItem {
  return { ...item, status: 'custom', resolution, dirty: true, options: [...item.options], reportedBy: [...item.reportedBy] };
}

/**
 * Return a new FindingItem with status 'deferred'. No resolution required.
 * Original item is not modified; sets dirty: true.
 */
export function markDeferred(item: FindingItem): FindingItem {
  return { ...item, status: 'deferred', dirty: true, options: [...item.options], reportedBy: [...item.reportedBy] };
}

/**
 * Return a new FindingItem with status 'skipped'. No resolution required.
 * Original item is not modified; sets dirty: true.
 */
export function markSkipped(item: FindingItem): FindingItem {
  return { ...item, status: 'skipped', dirty: true, options: [...item.options], reportedBy: [...item.reportedBy] };
}

/**
 * Return a new FindingItem with status 'unresolved'. Reverts to pending.
 * Original item is not modified; sets dirty: true.
 */
export function markUnresolved(item: FindingItem): FindingItem {
  return { ...item, status: 'unresolved', dirty: true, options: [...item.options], reportedBy: [...item.reportedBy] };
}

/**
 * Return a new FindingItem with the given resolution text set, without changing status.
 * Pass an empty string to clear it.
 * Original item is not modified; sets dirty: true.
 */
export function withResolution(item: FindingItem, text: string): FindingItem {
  return { ...item, resolution: text, dirty: true, options: [...item.options], reportedBy: [...item.reportedBy] };
}
