import type * as vscode from 'vscode';
import { getOutputChannel } from '../runtime/findings-state';

let activeThreads: vscode.CommentThread[] = [];

export function setActiveThreads(next: vscode.CommentThread[]): void {
  disposeAll();
  activeThreads = [...next];
}

export function disposeAll(): void {
  if (activeThreads.length === 0) {
    return;
  }
  const toDispose = activeThreads;
  activeThreads = [];
  for (const thread of toDispose) {
    try {
      thread.dispose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        getOutputChannel().appendLine(
          `Failed to dispose comment thread: ${message}`,
        );
      } catch {
        console.warn('[review-plugin] Failed to dispose comment thread:', message);
      }
    }
  }
}

export function getActiveThreads(): readonly vscode.CommentThread[] {
  return activeThreads;
}
