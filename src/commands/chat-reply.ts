import * as vscode from 'vscode';
import {
  appendChat,
  serializeDocument,
  type ChatMessage,
  type FindingItem,
  type HandoverDocument,
} from '../schema';
import type { LoadedFindings } from '../runtime/findings-state';
import type { FindingsWriter } from '../runtime/findings-writer';
import {
  ChatAlreadyInFlightError,
  type ChatSessionStore,
} from '../runtime/chat-session';
import { ClaudeRunnerError, type ClaudeRunner } from '../llm/claude-runner';
import type { HunkLoader, HunkLoadResult } from '../llm/hunk-loader';
import type { BuildPromptInput } from '../llm/prompt-builder';
import type { RenderChatDeps } from '../comments/chat-renderer';

export const CHAT_SEND_COMMAND_ID = 'reviewPlugin.chat.send';

export interface ChatReplyArgs {
  thread: vscode.CommentThread;
  text: string;
}

export interface ChatReplyLog {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export interface ChatReplyWindow {
  showErrorMessage: (msg: string) => Thenable<string | undefined> | Promise<string | undefined>;
  showInformationMessage: (msg: string) => Thenable<string | undefined> | Promise<string | undefined>;
}

export interface ChatReplyPromptBuilder {
  build: (input: BuildPromptInput) => string;
}

export interface ChatReplyRenderer {
  (
    thread: vscode.CommentThread,
    item: FindingItem,
    deps: RenderChatDeps,
  ): void;
}

export interface ChatReplyDeps {
  getState: () => LoadedFindings | null;
  setState: (next: LoadedFindings) => void;
  writer: FindingsWriter;
  runExclusive: <T>(filePath: string, fn: () => Promise<T>) => Promise<T>;
  runner: ClaudeRunner;
  promptBuilder: ChatReplyPromptBuilder;
  hunkLoader: HunkLoader;
  sessions: ChatSessionStore;
  renderChat: ChatReplyRenderer;
  refreshThread: (thread: vscode.CommentThread, item: FindingItem) => void;
  findIdByThread: (thread: vscode.CommentThread) => string | undefined;
  getAuthorLabel: () => string | undefined;
  log: ChatReplyLog;
  window: ChatReplyWindow;
}

const PLACEHOLDER_BODY = '_(thinking…)_';
const PLACEHOLDER_AUTHOR = 'Review Agent';
const ERROR_MARKER_PREFIX = '_(error)_';

export function createChatReplyHandler(
  deps: ChatReplyDeps,
): (args: ChatReplyArgs) => Promise<void> {
  return async (args) => {
    await runChatReply(deps, args);
  };
}

async function runChatReply(deps: ChatReplyDeps, args: ChatReplyArgs): Promise<void> {
  const { thread, text } = args;

  const id = deps.findIdByThread(thread);
  if (id === undefined) {
    deps.log.error(
      'Chat reply ignored — thread is not registered. Reload the findings file and retry.',
    );
    return;
  }

  const preState = deps.getState();
  if (preState === null) {
    deps.log.error(
      `Chat reply for finding ${id} ignored — no findings loaded.`,
    );
    return;
  }
  const filePath = preState.filePath;

  let userWriteSucceeded = false;
  let stateAfterUserWrite: LoadedFindings | null = null;

  try {
    stateAfterUserWrite = await deps.runExclusive(filePath, async () => {
      const state = deps.getState();
      if (state === null) {
        throw new Error('findings state cleared mid-chat-reply');
      }
      const newDoc = appendChat(state.doc, id, { role: 'user', content: text });
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
    userWriteSucceeded = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log.error(`Chat reply (user write) failed for ${id}: ${message}`);
    await deps.window.showErrorMessage(
      `Review Plugin: failed to save chat reply — ${message}`,
    );
    return;
  }

  if (!userWriteSucceeded || stateAfterUserWrite === null) {
    return;
  }

  const itemAfterUser = findItem(stateAfterUserWrite.doc, id);
  if (itemAfterUser === undefined) {
    deps.log.error(
      `Chat reply user write committed but item ${id} not found in updated doc.`,
    );
    return;
  }

  const placeholder = createPlaceholderComment();
  deps.renderChat(thread, itemAfterUser, { getAuthorLabel: deps.getAuthorLabel });
  appendPlaceholder(thread, placeholder);

  let signal: AbortSignal;
  try {
    signal = deps.sessions.start(id);
  } catch (err) {
    if (err instanceof ChatAlreadyInFlightError) {
      deps.log.warn(
        `Chat reply for ${id} ignored — a previous chat is still in flight.`,
      );
      removePlaceholder(thread, placeholder);
      deps.renderChat(thread, itemAfterUser, {
        getAuthorLabel: deps.getAuthorLabel,
      });
      return;
    }
    throw err;
  }
  deps.sessions.setPlaceholder(id, placeholder);

  let stdout: string;
  try {
    const hunkResult = await loadHunkSafely(deps, itemAfterUser);
    const priorTranscript = sliceTranscriptExcludingLastUser(itemAfterUser.chat);
    const prompt = deps.promptBuilder.build({
      item: itemAfterUser,
      hunkResult,
      transcript: priorTranscript,
      userMessage: text,
    });
    stdout = await deps.runner.run(prompt, signal);
  } catch (err) {
    await handleRunnerError(deps, thread, itemAfterUser, placeholder, err);
    deps.sessions.complete(id);
    return;
  }

  deps.sessions.complete(id);

  let finalState: LoadedFindings;
  try {
    finalState = await deps.runExclusive(filePath, async () => {
      const state = deps.getState();
      if (state === null) {
        throw new Error('findings state cleared before assistant write');
      }
      const newDoc = appendChat(state.doc, id, {
        role: 'assistant',
        content: stdout,
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
    const message = err instanceof Error ? err.message : String(err);
    deps.log.error(`Chat reply (assistant write) failed for ${id}: ${message}`);
    await deps.window.showErrorMessage(
      `Review Plugin: failed to save agent reply — ${message}`,
    );
    replacePlaceholderWithError(thread, placeholder, message);
    return;
  }

  const finalItem = findItem(finalState.doc, id);
  if (finalItem === undefined) {
    deps.log.error(
      `Chat reply assistant write committed but item ${id} not found in updated doc.`,
    );
    return;
  }
  removePlaceholder(thread, placeholder);
  deps.refreshThread(thread, finalItem);
  deps.renderChat(thread, finalItem, { getAuthorLabel: deps.getAuthorLabel });
  deps.log.info(`Chat reply for ${id} completed — chat length ${finalItem.chat?.length ?? 0}.`);
}

async function loadHunkSafely(
  deps: ChatReplyDeps,
  item: FindingItem,
): Promise<HunkLoadResult> {
  if (item.location.kind !== 'file') {
    return { hunk: '(review body — no file hunk available)', startLine: 1, lang: 'text' };
  }
  return deps.hunkLoader.load(item.location.file, item.location.line);
}

function sliceTranscriptExcludingLastUser(
  chat: readonly ChatMessage[] | undefined,
): ChatMessage[] {
  if (chat === undefined || chat.length === 0) {
    return [];
  }
  const last = chat[chat.length - 1];
  if (last.role === 'user') {
    return chat.slice(0, -1).map(cloneMessage);
  }
  return chat.map(cloneMessage);
}

function cloneMessage(m: ChatMessage): ChatMessage {
  return { role: m.role, content: m.content };
}

function findItem(doc: HandoverDocument, id: string): FindingItem | undefined {
  return doc.items.find((it) => it.id === id);
}

function createPlaceholderComment(): vscode.Comment {
  return {
    body: new vscode.MarkdownString(PLACEHOLDER_BODY),
    mode: vscode.CommentMode.Preview,
    author: { name: PLACEHOLDER_AUTHOR },
    contextValue: 'review-chat-placeholder',
  };
}

function appendPlaceholder(
  thread: vscode.CommentThread,
  placeholder: vscode.Comment,
): void {
  thread.comments = [...thread.comments, placeholder];
}

function removePlaceholder(
  thread: vscode.CommentThread,
  placeholder: vscode.Comment,
): void {
  thread.comments = thread.comments.filter((c) => c !== placeholder);
}

function replacePlaceholderWithError(
  thread: vscode.CommentThread,
  placeholder: vscode.Comment,
  detail: string,
): void {
  const idx = thread.comments.indexOf(placeholder);
  const errorBody = `${ERROR_MARKER_PREFIX} ${truncate(detail, 500)}`;
  const errorComment: vscode.Comment = {
    body: new vscode.MarkdownString(errorBody),
    mode: vscode.CommentMode.Preview,
    author: { name: PLACEHOLDER_AUTHOR },
    contextValue: 'review-chat-error',
  };
  const next = thread.comments.slice();
  if (idx === -1) {
    next.push(errorComment);
  } else {
    next[idx] = errorComment;
  }
  thread.comments = next;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return `${s.slice(0, max)}…`;
}

async function handleRunnerError(
  deps: ChatReplyDeps,
  thread: vscode.CommentThread,
  item: FindingItem,
  placeholder: vscode.Comment,
  err: unknown,
): Promise<void> {
  if (err instanceof ClaudeRunnerError) {
    if (err.kind === 'aborted') {
      deps.log.warn(`Chat reply for ${item.id} cancelled.`);
      removePlaceholder(thread, placeholder);
      return;
    }
    if (err.kind === 'enoent') {
      deps.log.error(`Chat reply for ${item.id} failed — claude CLI not found.`);
      replacePlaceholderWithError(
        thread,
        placeholder,
        'claude CLI not found. Install Claude Code and run `claude login` first.',
      );
      await deps.window.showErrorMessage(
        'claude CLI not found. Install Claude Code and run `claude login` first.',
      );
      return;
    }
    if (err.kind === 'auth') {
      deps.log.error(`Chat reply for ${item.id} failed — claude CLI not authenticated.`);
      replacePlaceholderWithError(
        thread,
        placeholder,
        'claude CLI not authenticated — run `claude login`.',
      );
      await deps.window.showErrorMessage(
        'claude CLI not authenticated — run `claude login`.',
      );
      return;
    }
    const tail = truncate(err.stderr || err.message, 500);
    deps.log.error(`Chat reply for ${item.id} failed — exit ${err.code ?? 'null'}: ${err.stderr}`);
    replacePlaceholderWithError(thread, placeholder, tail);
    await deps.window.showErrorMessage(
      `claude CLI failed — see thread (${tail})`,
    );
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  deps.log.error(`Chat reply for ${item.id} failed — ${message}`);
  replacePlaceholderWithError(thread, placeholder, message);
  await deps.window.showErrorMessage(
    `claude CLI failed — ${message}`,
  );
}
