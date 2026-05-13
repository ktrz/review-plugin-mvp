import type { ChatMessage, FindingItem, HandoverDocument } from './types';

export class UnknownIdError extends Error {
  readonly findingId: string;

  constructor(findingId: string) {
    super(`Unknown finding id: ${findingId}`);
    this.name = 'UnknownIdError';
    this.findingId = findingId;
  }
}

function cloneChat(chat: ChatMessage[] | undefined): ChatMessage[] | undefined {
  return chat === undefined ? undefined : [...chat];
}

/**
 * Return a new FindingItem with status 'resolved' and the given resolution.
 * Resolution is required for resolved status.
 * Original item is not modified; sets dirty: true.
 */
export function markResolved(item: FindingItem, resolution: string): FindingItem {
  return {
    ...item,
    status: 'resolved',
    resolution,
    dirty: true,
    options: [...item.options],
    reportedBy: [...item.reportedBy],
    chat: cloneChat(item.chat),
  };
}

/**
 * Return a new FindingItem with status 'custom' (approved with edits) and the given resolution.
 * Original item is not modified; sets dirty: true.
 */
export function markCustom(item: FindingItem, resolution: string): FindingItem {
  return {
    ...item,
    status: 'custom',
    resolution,
    dirty: true,
    options: [...item.options],
    reportedBy: [...item.reportedBy],
    chat: cloneChat(item.chat),
  };
}

/**
 * Return a new FindingItem with status 'deferred'. No resolution required.
 * Original item is not modified; sets dirty: true.
 */
export function markDeferred(item: FindingItem): FindingItem {
  return {
    ...item,
    status: 'deferred',
    dirty: true,
    options: [...item.options],
    reportedBy: [...item.reportedBy],
    chat: cloneChat(item.chat),
  };
}

/**
 * Return a new FindingItem with status 'skipped'. No resolution required.
 * Original item is not modified; sets dirty: true.
 */
export function markSkipped(item: FindingItem): FindingItem {
  return {
    ...item,
    status: 'skipped',
    dirty: true,
    options: [...item.options],
    reportedBy: [...item.reportedBy],
    chat: cloneChat(item.chat),
  };
}

/**
 * Return a new FindingItem with status 'unresolved'. Reverts to pending.
 * Original item is not modified; sets dirty: true.
 */
export function markUnresolved(item: FindingItem): FindingItem {
  return {
    ...item,
    status: 'unresolved',
    dirty: true,
    options: [...item.options],
    reportedBy: [...item.reportedBy],
    chat: cloneChat(item.chat),
  };
}

/**
 * Return a new FindingItem with the given resolution text set, without changing status.
 * Pass an empty string to clear it.
 * Original item is not modified; sets dirty: true.
 */
export function withResolution(item: FindingItem, text: string): FindingItem {
  return {
    ...item,
    resolution: text,
    dirty: true,
    options: [...item.options],
    reportedBy: [...item.reportedBy],
    chat: cloneChat(item.chat),
  };
}

/**
 * Return a new HandoverDocument with the given chat message appended to the
 * target finding's chat array. Creates an empty array if absent. Sets dirty: true
 * on the mutated item. Throws UnknownIdError if no item with the given id exists.
 */
export function appendChat(
  doc: HandoverDocument,
  findingId: string,
  message: ChatMessage,
): HandoverDocument {
  const index = doc.items.findIndex((it) => it.id === findingId);
  if (index === -1) {
    throw new UnknownIdError(findingId);
  }
  const current = doc.items[index];
  const nextChat: ChatMessage[] = current.chat ? [...current.chat, message] : [message];
  const nextItem: FindingItem = {
    ...current,
    dirty: true,
    options: [...current.options],
    reportedBy: [...current.reportedBy],
    chat: nextChat,
  };
  const nextItems = doc.items.slice();
  nextItems[index] = nextItem;
  return { ...doc, items: nextItems };
}
