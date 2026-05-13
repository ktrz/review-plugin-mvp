import type { FindingItem, HandoverDocument } from './types';

export interface StampDeps {
  generateId: () => string;
}

/**
 * Return a new HandoverDocument where every item with an empty `id` has been
 * stamped with a fresh ID (and marked `dirty: true` so the next serialize emits
 * the new field). Items that already carry a non-empty `id` are returned
 * unchanged, preserving their `dirty` flag and `rawSource`.
 *
 * Pure: all randomness flows through `deps.generateId` for deterministic tests.
 */
export function stampMissingIds(doc: HandoverDocument, deps: StampDeps): HandoverDocument {
  let mutated = false;
  const items = doc.items.map((item) => {
    if (item.id) {
      return item;
    }
    mutated = true;
    return stampItem(item, deps.generateId());
  });
  if (!mutated) {
    return doc;
  }
  return { ...doc, items };
}

function stampItem(item: FindingItem, id: string): FindingItem {
  return {
    ...item,
    id,
    dirty: true,
    options: [...item.options],
    reportedBy: [...item.reportedBy],
  };
}
