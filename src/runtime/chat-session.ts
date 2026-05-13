import type * as vscode from 'vscode';

export class ChatAlreadyInFlightError extends Error {
  constructor(public readonly id: string) {
    super(`Chat already in flight for finding ${id}`);
    this.name = 'ChatAlreadyInFlightError';
  }
}

interface ChatSessionEntry {
  abortCtrl: AbortController;
  placeholder?: vscode.Comment;
}

export interface ChatSessionStore {
  start(id: string): AbortSignal;
  complete(id: string): void;
  abort(id: string): void;
  isInFlight(id: string): boolean;
  setPlaceholder(id: string, comment: vscode.Comment): void;
  getPlaceholder(id: string): vscode.Comment | undefined;
}

export function createChatSessionStore(): ChatSessionStore {
  const entries = new Map<string, ChatSessionEntry>();

  function start(id: string): AbortSignal {
    if (entries.has(id)) {
      throw new ChatAlreadyInFlightError(id);
    }
    const abortCtrl = new AbortController();
    entries.set(id, { abortCtrl });
    return abortCtrl.signal;
  }

  function complete(id: string): void {
    entries.delete(id);
  }

  function abort(id: string): void {
    const entry = entries.get(id);
    if (entry === undefined) {
      return;
    }
    entry.abortCtrl.abort();
    entries.delete(id);
  }

  function isInFlight(id: string): boolean {
    return entries.has(id);
  }

  function setPlaceholder(id: string, comment: vscode.Comment): void {
    const entry = entries.get(id);
    if (entry === undefined) {
      return;
    }
    entry.placeholder = comment;
  }

  function getPlaceholder(id: string): vscode.Comment | undefined {
    return entries.get(id)?.placeholder;
  }

  return { start, complete, abort, isInFlight, setPlaceholder, getPlaceholder };
}
