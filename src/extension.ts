import * as vscode from 'vscode';
import {
  clearState,
  getState,
  setOutputChannel,
  setState,
  type LoadedFindings,
} from './runtime/findings-state';
import {
  disposeActiveWatcher,
  registerLoadFindingsCommand,
} from './commands/load-findings';
import { createFindingsController } from './comments/controller';
import { disposeAll as disposeActiveThreads } from './comments/render-session';
import { createFindingsWriter } from './runtime/findings-writer';
import {
  buildDefaultThreadCommandDeps,
  registerThreadCommands,
  type ThreadActionLog,
  type ThreadActionState,
} from './commands/thread-actions';
import { registerFinalizeSessionCommand } from './commands/finalize-session';
import { safeSetContext } from './runtime/vscode-context';

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('Review Plugin');
  setOutputChannel(channel);
  context.subscriptions.push(channel);
  const controller = createFindingsController();
  context.subscriptions.push(controller);
  const writer = createFindingsWriter();
  registerLoadFindingsCommand(context, { controller, writer });

  const log: ThreadActionLog = {
    info: (msg) => channel.appendLine(msg),
    warn: (msg) => channel.appendLine(`[warn] ${msg}`),
    error: (msg) => channel.appendLine(`[error] ${msg}`),
  };
  const threadDeps = buildDefaultThreadCommandDeps({
    writer,
    getState: () => loadedToThreadState(getState()),
    setState: (next) => setState(threadStateToLoaded(next)),
    log,
  });
  const threadCommands = registerThreadCommands(context, threadDeps);
  context.subscriptions.push(threadCommands);

  registerFinalizeSessionCommand(context);
  safeSetContext(
    { warn: (msg) => channel.appendLine(`[warn] ${msg}`) },
    'reviewPlugin.hasFindings',
    false,
  );
}

export function deactivate(): void {
  disposeActiveThreads();
  clearState();
  disposeActiveWatcher();
}

function loadedToThreadState(state: LoadedFindings | null): ThreadActionState | null {
  if (state === null) {
    return null;
  }
  return {
    doc: state.doc,
    mtime: state.mtime,
    filePath: state.filePath,
    prNumber: state.prNumber,
    lastWriteSha: state.lastWriteSha,
  };
}

function threadStateToLoaded(next: ThreadActionState): LoadedFindings {
  return {
    doc: next.doc,
    mtime: next.mtime,
    filePath: next.filePath,
    prNumber: next.prNumber,
    lastWriteSha: next.lastWriteSha,
  };
}
