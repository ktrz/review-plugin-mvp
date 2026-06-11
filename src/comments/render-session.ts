import * as vscode from 'vscode';
import { getOutputChannel } from '../runtime/findings-state';
import {
  canReplyForStatus,
  collapsibleStateForStatus,
  composeBody,
  contextValueForFinding,
  formatSourceLabel,
  iconForSource,
  threadStateForStatus,
  type ThreadEntry,
} from './thread-builder';
import { renderChat } from './chat-renderer';
import { ensureRoundAvatar } from './avatar-cache';
import type { FindingItem } from '../schema';

interface RegistryEntry {
  thread: vscode.CommentThread;
  item: FindingItem;
}

let activeThreads: vscode.CommentThread[] = [];
const idToEntry = new Map<string, RegistryEntry>();
const threadToId = new WeakMap<vscode.CommentThread, string>();

export function setActiveEntries(next: readonly ThreadEntry[]): void {
  disposeAll();
  activeThreads = next.map((e) => e.thread);
  for (const entry of next) {
    idToEntry.set(entry.id, { thread: entry.thread, item: entry.item });
    threadToId.set(entry.thread, entry.id);
  }
}

export function findThreadById(id: string): RegistryEntry | undefined {
  return idToEntry.get(id);
}

export function findIdByThread(thread: vscode.CommentThread): string | undefined {
  return threadToId.get(thread);
}

export function refreshThread(
  thread: vscode.CommentThread,
  newItem: FindingItem,
): void {
  const id = threadToId.get(thread);
  if (id === undefined) {
    logWarning(`refreshThread called for an unregistered thread (item id ${newItem.id})`);
    return;
  }
  const sourceLabel = formatSourceLabel(newItem.source);
  thread.label = `[${newItem.status}] ${newItem.source.severity} · ${sourceLabel}`;
  thread.contextValue = contextValueForFinding(newItem);
  thread.state = threadStateForStatus(newItem.status);
  thread.collapsibleState = collapsibleStateForStatus(newItem.status);
  thread.canReply = canReplyForStatus(newItem.status);
  thread.comments = [composeRefreshedComment(newItem, thread.comments[0])];
  if ((newItem.chat?.length ?? 0) > 0) {
    renderChat(thread, newItem, { getAuthorLabel: () => undefined });
  }
  idToEntry.set(id, { thread, item: newItem });
}

export interface ReconcileDeps {
  entries: readonly ThreadEntry[];
}

export function reconcileEntries(deps: ReconcileDeps): void {
  const { entries } = deps;
  const nextIds = new Set(entries.map((e) => e.id));
  for (const [id, existing] of idToEntry) {
    if (nextIds.has(id)) {
      continue;
    }
    disposeOne(existing.thread);
    idToEntry.delete(id);
    threadToId.delete(existing.thread);
  }
  const nextActive: vscode.CommentThread[] = [];
  for (const entry of entries) {
    const existing = idToEntry.get(entry.id);
    if (existing !== undefined && existing.thread === entry.thread) {
      refreshThread(entry.thread, entry.item);
      nextActive.push(entry.thread);
      continue;
    }
    if (existing !== undefined && existing.thread !== entry.thread) {
      disposeOne(existing.thread);
      threadToId.delete(existing.thread);
    }
    idToEntry.set(entry.id, { thread: entry.thread, item: entry.item });
    threadToId.set(entry.thread, entry.id);
    nextActive.push(entry.thread);
  }
  activeThreads = nextActive;
}

export function disposeAll(): void {
  if (activeThreads.length === 0 && idToEntry.size === 0) {
    return;
  }
  const toDispose = activeThreads;
  activeThreads = [];
  for (const [, entry] of idToEntry) {
    threadToId.delete(entry.thread);
  }
  idToEntry.clear();
  for (const thread of toDispose) {
    disposeOne(thread);
  }
}

export function getActiveThreads(): readonly vscode.CommentThread[] {
  return activeThreads;
}

// Fetches a circular GitHub avatar per reviewer and swaps it onto the finding
// comment once ready. Non-blocking: the square avatar is shown until each
// fetch resolves; failures leave the square one in place.
export async function upgradeReviewerAvatars(
  entries: readonly ThreadEntry[],
): Promise<void> {
  await Promise.all(
    entries.map(async (entry) => {
      if (entry.item.source.kind !== 'reviewer') {
        return;
      }
      const login = entry.item.source.login;
      try {
        const uri = await ensureRoundAvatar(login);
        if (uri !== undefined) {
          applyFindingIcon(entry.id, uri);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logWarning(`Could not load rounded avatar for @${login}: ${message}`);
      }
    }),
  );
}

function applyFindingIcon(id: string, iconPath: vscode.Uri): void {
  const entry = idToEntry.get(id);
  if (entry === undefined) {
    return;
  }
  const comments = entry.thread.comments;
  const finding = comments[0];
  if (finding === undefined) {
    return;
  }
  entry.thread.comments = [
    { ...finding, author: { ...finding.author, iconPath } },
    ...comments.slice(1),
  ];
}

function disposeOne(thread: vscode.CommentThread): void {
  try {
    thread.dispose();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const formatted = `Failed to dispose comment thread: ${message}`;
    try {
      getOutputChannel().appendLine(formatted);
    } catch {
      console.warn('[review-plugin] Failed to dispose comment thread:', message);
    }
  }
}

function logWarning(message: string): void {
  try {
    getOutputChannel().appendLine(message);
  } catch {
    console.warn(`[review-plugin] ${message}`);
  }
}

function composeRefreshedComment(
  newItem: FindingItem,
  previous: vscode.Comment | undefined,
): vscode.Comment {
  return {
    body: composeBody(newItem),
    mode: previous?.mode ?? vscode.CommentMode.Preview,
    author: { name: formatSourceLabel(newItem.source), iconPath: iconForSource(newItem.source) },
    contextValue: previous?.contextValue ?? 'review-finding-comment',
  };
}
