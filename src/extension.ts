import { readFile as fsReadFile } from 'node:fs/promises';
import { spawn as defaultSpawn } from 'node:child_process';
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
import {
  disposeAll as disposeActiveThreads,
  findIdByThread as defaultFindIdByThread,
  refreshThread as defaultRefreshThread,
} from './comments/render-session';
import { createFindingsWriter } from './runtime/findings-writer';
import { runExclusive } from './runtime/transaction-queue';
import {
  buildDefaultThreadCommandDeps,
  registerThreadCommands,
  type ThreadActionLog,
  type ThreadActionState,
} from './commands/thread-actions';
import { registerFinalizeSessionCommand } from './commands/finalize-session';
import { safeSetContext } from './runtime/vscode-context';
import {
  createClaudeRunner,
  type ClaudeChildProcess,
  type ClaudeChildStream,
  type ClaudeRunner,
} from './llm/claude-runner';
import { createHunkLoader } from './llm/hunk-loader';
import { buildPrompt } from './llm/prompt-builder';
import { createChatSessionStore } from './runtime/chat-session';
import { renderChat } from './comments/chat-renderer';
import {
  CHAT_SEND_COMMAND_ID,
  createChatReplyHandler,
  type ChatReplyArgs,
} from './commands/chat-reply';
import {
  FINALIZE_CHAT_COMMAND_ID,
  createFinalizeChatHandler,
} from './commands/finalize-chat';

const REPLY_PROMPT = 'Reply…';
const REPLY_PLACEHOLDER = 'Type your message';
const DEFAULT_CLI_PATH = 'claude';

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

  registerChatCommands(context, { writer, log });

  wireCommentingRangeProvider(controller);
  controller.options = {
    prompt: REPLY_PROMPT,
    placeHolder: REPLY_PLACEHOLDER,
  };

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

interface RegisterChatDeps {
  writer: ReturnType<typeof createFindingsWriter>;
  log: ThreadActionLog;
}

function registerChatCommands(
  context: vscode.ExtensionContext,
  deps: RegisterChatDeps,
): void {
  const sessions = createChatSessionStore();
  const hunkLoader = createHunkLoader({
    readFile: (filePath) => fsReadFile(filePath, 'utf8'),
  });
  const runner = buildClaudeRunner();

  const chatReplyHandler = createChatReplyHandler({
    getState,
    setState,
    writer: deps.writer,
    runExclusive,
    runner,
    promptBuilder: { build: buildPrompt },
    hunkLoader,
    sessions,
    renderChat,
    refreshThread: defaultRefreshThread,
    findIdByThread: defaultFindIdByThread,
    getAuthorLabel: () => undefined,
    log: deps.log,
    window: {
      showErrorMessage: (msg) => vscode.window.showErrorMessage(msg),
      showInformationMessage: (msg) => vscode.window.showInformationMessage(msg),
    },
  });

  const finalizeChatHandler = createFinalizeChatHandler({
    getState,
    setState,
    writer: deps.writer,
    runExclusive,
    findIdByThread: defaultFindIdByThread,
    refreshThread: defaultRefreshThread,
    renderChat,
    getAuthorLabel: () => undefined,
    window: {
      showInputBox: (options) => vscode.window.showInputBox(options),
      showInformationMessage: (msg) => vscode.window.showInformationMessage(msg),
      showErrorMessage: (msg) => vscode.window.showErrorMessage(msg),
    },
    log: deps.log,
  });

  const sendDisposable = vscode.commands.registerCommand(
    CHAT_SEND_COMMAND_ID,
    (reply: vscode.CommentReply | ChatReplyArgs) => {
      const args = normalizeChatReplyArgs(reply);
      if (args === null) {
        deps.log.warn('Chat send invoked with no thread/text — ignored.');
        return Promise.resolve();
      }
      return chatReplyHandler(args);
    },
  );
  context.subscriptions.push(sendDisposable);

  const finalizeDisposable = vscode.commands.registerCommand(
    FINALIZE_CHAT_COMMAND_ID,
    (thread: vscode.CommentThread) => finalizeChatHandler(thread),
  );
  context.subscriptions.push(finalizeDisposable);
}

function normalizeChatReplyArgs(
  reply: vscode.CommentReply | ChatReplyArgs | undefined,
): ChatReplyArgs | null {
  if (reply === undefined || reply === null) {
    return null;
  }
  const candidate = reply as Partial<ChatReplyArgs> & Partial<vscode.CommentReply>;
  if (candidate.thread === undefined) {
    return null;
  }
  if (typeof candidate.text !== 'string' || candidate.text.length === 0) {
    return null;
  }
  return { thread: candidate.thread, text: candidate.text };
}

function buildClaudeRunner(): ClaudeRunner {
  return createClaudeRunner({
    spawn: (command, args, options) => {
      const child = defaultSpawn(command, [...args], {
        cwd: options.cwd,
        stdio: options.stdio,
      });
      return adaptChildProcess(child);
    },
    getCliPath: () => {
      const cfg = vscode.workspace.getConfiguration('reviewPlugin.claude');
      const cliPath = cfg.get<string>('cliPath');
      return cliPath !== undefined && cliPath.length > 0
        ? cliPath
        : DEFAULT_CLI_PATH;
    },
    getExtraArgs: () => {
      const cfg = vscode.workspace.getConfiguration('reviewPlugin.claude');
      return cfg.get<readonly string[]>('extraArgs') ?? [];
    },
    getWorkspaceRoot: () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      return folder?.uri.fsPath ?? process.cwd();
    },
  });
}

function adaptChildProcess(
  child: ReturnType<typeof defaultSpawn>,
): ClaudeChildProcess {
  return {
    stdin: child.stdin,
    stdout: child.stdout === null ? null : asStream(child.stdout),
    stderr: child.stderr === null ? null : asStream(child.stderr),
    on(event: 'error' | 'close', listener: never): unknown {
      if (event === 'error') {
        child.on('error', listener);
        return child;
      }
      child.on('close', listener);
      return child;
    },
    kill(signal?: NodeJS.Signals): boolean {
      return child.kill(signal);
    },
  };
}

function asStream(stream: NodeJS.ReadableStream): ClaudeChildStream {
  return {
    on(event: 'data', listener: (chunk: Buffer | string) => void): unknown {
      stream.on(event, listener);
      return stream;
    },
  };
}

function wireCommentingRangeProvider(
  controller: vscode.CommentController,
): void {
  controller.commentingRangeProvider = {
    provideCommentingRanges(
      document: vscode.TextDocument,
    ): vscode.Range[] | undefined {
      const lineCount = document.lineCount;
      if (lineCount <= 0) {
        return undefined;
      }
      return [new vscode.Range(0, 0, Math.max(0, lineCount - 1), 0)];
    },
  };
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
