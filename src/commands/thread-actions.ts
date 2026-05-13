import * as vscode from 'vscode';
import type { HandoverDocument } from '../schema';
import { serializeDocument } from '../schema';
import { applyDecision, type ThreadDecision } from '../comments/apply-decision';
import type { FindingItemWithId } from '../comments/thread-builder';
import {
  findIdByThread as defaultFindIdByThread,
  refreshThread as defaultRefreshThread,
} from '../comments/render-session';
import {
  createFindingsWriter,
  type FindingsWriter,
} from '../runtime/findings-writer';
import { runExclusive as defaultRunExclusive } from '../runtime/transaction-queue';

export type ThreadActionState = {
  doc: Readonly<HandoverDocument>;
  mtime: number;
  filePath: string;
  prNumber: number;
  lastWriteSha?: string;
};

export type ThreadActionLog = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

export type RegisterThreadCommandsDeps = {
  writer: FindingsWriter;
  getState: () => ThreadActionState | null;
  setState: (next: ThreadActionState) => void;
  findIdByThread: (thread: vscode.CommentThread) => string | undefined;
  refreshThread: (thread: vscode.CommentThread, item: FindingItemWithId) => void;
  runExclusive: <T>(filePath: string, fn: () => Promise<T>) => Promise<T>;
  log: ThreadActionLog;
  showError: (message: string) => Thenable<string | undefined> | void;
};

export type CommandIdMap = Readonly<Record<ThreadDecision, string>>;

export const THREAD_COMMAND_IDS: CommandIdMap = {
  post: 'reviewPlugin.thread.post',
  dismiss: 'reviewPlugin.thread.dismiss',
  discuss: 'reviewPlugin.thread.discuss',
  unresolve: 'reviewPlugin.thread.unresolve',
};

const SAVING_SUFFIX = ' (saving…)';

export function registerThreadCommands(
  context: vscode.ExtensionContext,
  deps: RegisterThreadCommandsDeps,
): vscode.Disposable {
  const disposables: vscode.Disposable[] = [];
  const decisions: readonly ThreadDecision[] = ['post', 'dismiss', 'discuss', 'unresolve'];
  for (const decision of decisions) {
    const id = THREAD_COMMAND_IDS[decision];
    const handler = (thread: vscode.CommentThread): Promise<void> =>
      handleThreadDecision({ thread, decision, deps });
    const disposable = vscode.commands.registerCommand(id, handler);
    disposables.push(disposable);
    context.subscriptions.push(disposable);
  }
  return {
    dispose(): void {
      for (const d of disposables) {
        try {
          d.dispose();
        } catch {
          // already-disposed disposables surface no useful signal here
        }
      }
    },
  };
}

export type HandleThreadDecisionArgs = {
  thread: vscode.CommentThread;
  decision: ThreadDecision;
  deps: RegisterThreadCommandsDeps;
};

export async function handleThreadDecision(
  args: HandleThreadDecisionArgs,
): Promise<void> {
  const { thread, decision, deps } = args;
  const preState = deps.getState();
  if (preState === null) {
    deps.log.warn(
      `Thread action ${decision} ignored — no findings loaded.`,
    );
    return;
  }
  const filePath = preState.filePath;
  await deps.runExclusive(filePath, async () => {
    await runThreadDecisionLocked({ thread, decision, deps });
  });
}

type LockedArgs = HandleThreadDecisionArgs;

async function runThreadDecisionLocked(args: LockedArgs): Promise<void> {
  const { thread, decision, deps } = args;

  const id = deps.findIdByThread(thread);
  if (id === undefined) {
    deps.log.warn(
      `Thread action ${decision} ignored — thread is no longer registered.`,
    );
    return;
  }

  const state = deps.getState();
  if (state === null) {
    deps.log.warn(
      `Thread action ${decision} ignored — findings state cleared mid-action.`,
    );
    return;
  }

  const originalLabel = thread.label;
  thread.label = `${originalLabel}${SAVING_SUFFIX}`;

  try {
    const newDoc = applyDecision(state.doc, id, decision);
    const serialized = serializeDocument(newDoc);
    const { mtime, sha } = await deps.writer.write(state.filePath, serialized);
    deps.setState({
      ...state,
      doc: newDoc,
      mtime,
      lastWriteSha: sha,
    });
    const updatedItem = findItemById(newDoc, id);
    if (updatedItem === undefined) {
      deps.log.error(
        `Thread action ${decision} committed write but updated item ${id} was not found in new doc.`,
      );
      return;
    }
    deps.refreshThread(thread, updatedItem);
    deps.log.info(
      `Thread action ${decision} applied to ${id} → status=${updatedItem.status}.`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log.error(
      `Thread action ${decision} failed for ${id}: ${message}`,
    );
    deps.showError(`Review Plugin: failed to ${decision} finding — ${message}`);
  } finally {
    thread.label = originalLabel;
  }
}

function findItemById(
  doc: HandoverDocument,
  id: string,
): FindingItemWithId | undefined {
  return doc.items.find((it) => it.id === id);
}

export function buildDefaultThreadCommandDeps(args: {
  getState: () => ThreadActionState | null;
  setState: (next: ThreadActionState) => void;
  log: ThreadActionLog;
  showError?: (message: string) => Thenable<string | undefined> | void;
  writer?: FindingsWriter;
}): RegisterThreadCommandsDeps {
  return {
    writer: args.writer ?? createFindingsWriter(),
    getState: args.getState,
    setState: args.setState,
    findIdByThread: defaultFindIdByThread,
    refreshThread: defaultRefreshThread,
    runExclusive: defaultRunExclusive,
    log: args.log,
    showError:
      args.showError ?? ((msg) => vscode.window.showErrorMessage(msg)),
  };
}
