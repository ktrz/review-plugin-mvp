import * as vscode from 'vscode';
import {
  serializeDocument,
  type FindingItem,
  type HandoverDocument,
} from '../schema';
import {
  applyDecision,
  ApplyDecisionError,
} from '../comments/apply-decision';
import type { LoadedFindings } from '../runtime/findings-state';
import type { FindingsWriter } from '../runtime/findings-writer';
import type { RenderChatDeps } from '../comments/chat-renderer';

export interface FinalizeChatLog {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export interface FinalizeChatWindow {
  showInputBox: (
    options: vscode.InputBoxOptions,
  ) => Thenable<string | undefined> | Promise<string | undefined>;
  showInformationMessage: (
    msg: string,
  ) => Thenable<string | undefined> | Promise<string | undefined>;
  showErrorMessage: (
    msg: string,
  ) => Thenable<string | undefined> | Promise<string | undefined>;
}

export interface FinalizeChatRenderer {
  (
    thread: vscode.CommentThread,
    item: FindingItem,
    deps: RenderChatDeps,
  ): void;
}

export interface FinalizeChatDeps {
  getState: () => LoadedFindings | null;
  setState: (next: LoadedFindings) => void;
  writer: FindingsWriter;
  runExclusive: <T>(filePath: string, fn: () => Promise<T>) => Promise<T>;
  findIdByThread: (thread: vscode.CommentThread) => string | undefined;
  refreshThread: (thread: vscode.CommentThread, item: FindingItem) => void;
  renderChat: FinalizeChatRenderer;
  getAuthorLabel: () => string | undefined;
  window: FinalizeChatWindow;
  log: FinalizeChatLog;
}

const NO_CHAT_MESSAGE = 'No chat to finalize — start a discussion first.';
const WAIT_FOR_AGENT_MESSAGE = 'Wait for the agent to reply first.';
const NOT_DEFERRED_MESSAGE = 'Finalize chat only applies to deferred findings.';
const INPUT_PROMPT = 'Edit the resolution wording, then submit.';
const EMPTY_VALIDATION = 'Resolution cannot be empty.';

export function createFinalizeChatHandler(
  deps: FinalizeChatDeps,
): (thread: vscode.CommentThread) => Promise<void> {
  return async (thread) => {
    await runFinalizeChat(deps, thread);
  };
}

async function runFinalizeChat(
  deps: FinalizeChatDeps,
  thread: vscode.CommentThread,
): Promise<void> {
  const id = deps.findIdByThread(thread);
  if (id === undefined) {
    deps.log.error(
      'Finalize-chat ignored — thread is not registered.',
    );
    return;
  }

  const preState = deps.getState();
  if (preState === null) {
    deps.log.error(
      `Finalize-chat for ${id} ignored — no findings loaded.`,
    );
    return;
  }

  const currentItem = findItem(preState.doc, id);
  if (currentItem === undefined) {
    deps.log.error(
      `Finalize-chat for ${id} ignored — item not found in current doc.`,
    );
    return;
  }

  if (currentItem.status !== 'deferred') {
    await deps.window.showInformationMessage(NOT_DEFERRED_MESSAGE);
    return;
  }

  const chat = currentItem.chat;
  if (chat === undefined || chat.length === 0) {
    await deps.window.showInformationMessage(NO_CHAT_MESSAGE);
    return;
  }

  const last = chat[chat.length - 1];
  if (last.role !== 'assistant') {
    await deps.window.showInformationMessage(WAIT_FOR_AGENT_MESSAGE);
    return;
  }

  const seed = last.content;
  const pick = await deps.window.showInputBox({
    value: seed,
    prompt: INPUT_PROMPT,
    validateInput: (s: string) => (s.trim().length === 0 ? EMPTY_VALIDATION : null),
  });
  if (pick === undefined) {
    return;
  }

  const filePath = preState.filePath;
  let finalState: LoadedFindings;
  try {
    finalState = await deps.runExclusive(filePath, async () => {
      const state = deps.getState();
      if (state === null) {
        throw new Error('findings state cleared mid-finalize-chat');
      }
      const newDoc = applyDecision(state.doc, id, {
        kind: 'finalizeChat',
        resolution: pick,
      });
      const serialized = serializeDocument(newDoc);
      const { mtime, sha } = await deps.writer.write(filePath, serialized);
      const next: LoadedFindings = {
        ...state,
        doc: newDoc,
        mtime,
        lastWriteSha: sha,
      };
      deps.setState(next);
      return next;
    });
  } catch (err) {
    const message = formatError(err);
    deps.log.error(`Finalize-chat failed for ${id}: ${message}`);
    await deps.window.showErrorMessage(
      `Review Plugin: finalize chat failed — ${message}`,
    );
    return;
  }

  const finalItem = findItem(finalState.doc, id);
  if (finalItem === undefined) {
    deps.log.error(
      `Finalize-chat for ${id} committed write but item not found in updated doc.`,
    );
    return;
  }
  deps.refreshThread(thread, finalItem);
  deps.renderChat(thread, finalItem, { getAuthorLabel: deps.getAuthorLabel });
  deps.log.info(`Finalize-chat for ${id} → status=${finalItem.status}.`);
}

function findItem(doc: HandoverDocument, id: string): FindingItem | undefined {
  return doc.items.find((it) => it.id === id);
}

function formatError(err: unknown): string {
  if (err instanceof ApplyDecisionError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
