import { createHash } from 'node:crypto';
import { readFile as fsReadFile, stat as fsStat } from 'node:fs/promises';
import * as vscode from 'vscode';
import {
  countByStatus,
  renderSummary,
  type RenderedSummary,
  type StatusCounts,
} from '../comments/finalize-summary';
import {
  getOutputChannel as defaultGetOutputChannel,
  getState as defaultGetState,
  type LoadedFindings,
} from '../runtime/findings-state';

export const FINALIZE_SESSION_COMMAND_ID = 'reviewPlugin.session.finalize';

const NO_SESSION_MESSAGE = 'No review session active.';
const DRIFT_WARNING_MESSAGE = 'Findings file changed on disk — reload first.';
const COPY_COMMAND_LABEL = 'Copy command';
const SHOW_SUMMARY_LABEL = 'Show summary';
const CANCEL_LABEL = 'Cancel';
const COPIED_MESSAGE = 'Command copied.';

export type FinalizeLog = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  appendLine: (msg: string) => void;
  show: (preserveFocus?: boolean) => void;
};

export type FinalizeWindow = {
  showInformationMessage: (
    msg: string,
    ...actions: string[]
  ) => Thenable<string | undefined> | Promise<string | undefined>;
  showWarningMessage: (
    msg: string,
    ...actions: string[]
  ) => Thenable<string | undefined> | Promise<string | undefined>;
  showErrorMessage: (
    msg: string,
    ...actions: string[]
  ) => Thenable<string | undefined> | Promise<string | undefined>;
};

export type FinalizeClipboard = {
  writeText: (text: string) => Promise<void> | Thenable<void>;
};

export type FinalizeStat = (filePath: string) => Promise<{ mtimeMs: number }>;
export type FinalizeReadFile = (filePath: string) => Promise<string>;
export type FinalizeSha256 = (data: string) => string;

export type FinalizeDeps = {
  getState: () => LoadedFindings | null;
  stat: FinalizeStat;
  readFile: FinalizeReadFile;
  sha256: FinalizeSha256;
  window: FinalizeWindow;
  log: FinalizeLog;
  clipboard: FinalizeClipboard;
};

export function createFinalizeHandler(
  deps: FinalizeDeps,
): () => Promise<void> {
  return async () => {
    try {
      await runFinalize(deps);
    } catch (err) {
      const message = formatError(err);
      deps.log.error(`Finalize session failed: ${message}`);
      await deps.window.showErrorMessage(
        `Review Plugin: finalize failed — ${message}`,
      );
    }
  };
}

export function registerFinalizeSessionCommand(
  context: vscode.ExtensionContext,
): void {
  const log = buildDefaultLog();
  const handler = createFinalizeHandler({
    getState: defaultGetState,
    stat: defaultStat,
    readFile: defaultReadFile,
    sha256: defaultSha256,
    window: vscode.window,
    log,
    clipboard: vscode.env.clipboard,
  });
  const disposable = vscode.commands.registerCommand(
    FINALIZE_SESSION_COMMAND_ID,
    handler,
  );
  context.subscriptions.push(disposable);
}

async function runFinalize(deps: FinalizeDeps): Promise<void> {
  const state = deps.getState();
  if (state === null) {
    deps.log.info('Finalize session: no review session active.');
    await deps.window.showInformationMessage(NO_SESSION_MESSAGE);
    return;
  }

  const filePath = state.filePath;

  const statResult = await statOrReportMissing({ deps, filePath });
  if (statResult === null) {
    return;
  }

  const driftCheck = await detectDrift({
    deps,
    filePath,
    diskMtime: statResult.mtimeMs,
    state,
  });
  if (driftCheck === 'drift') {
    return;
  }

  const counts = countByStatus([...state.doc.items]);
  const summary = renderSummary({ filePath, counts });
  deps.log.appendLine(summary.block);

  const incomplete = counts.unresolved + counts.deferred;
  if (incomplete > 0) {
    await promptIncomplete({ deps, summary });
    return;
  }
  await promptComplete({ deps, summary });
}

type StatResult = { mtimeMs: number };

async function statOrReportMissing(args: {
  deps: FinalizeDeps;
  filePath: string;
}): Promise<StatResult | null> {
  const { deps, filePath } = args;
  try {
    return await deps.stat(filePath);
  } catch (err) {
    if (isEnoent(err)) {
      const message = `Findings file not found at ${filePath}.`;
      deps.log.error(message);
      await deps.window.showErrorMessage(message);
      return null;
    }
    throw err;
  }
}

type DriftOutcome = 'ok' | 'drift';

async function detectDrift(args: {
  deps: FinalizeDeps;
  filePath: string;
  diskMtime: number;
  state: LoadedFindings;
}): Promise<DriftOutcome> {
  const { deps, filePath, diskMtime, state } = args;
  if (diskMtime === state.mtime) {
    return 'ok';
  }
  const raw = await deps.readFile(filePath);
  const diskSha = deps.sha256(raw);
  if (state.lastWriteSha !== undefined && diskSha === state.lastWriteSha) {
    return 'ok';
  }
  deps.log.warn(
    `Findings file ${filePath} changed on disk — finalize aborted.`,
  );
  await deps.window.showWarningMessage(DRIFT_WARNING_MESSAGE);
  return 'drift';
}

async function promptIncomplete(args: {
  deps: FinalizeDeps;
  summary: RenderedSummary;
}): Promise<void> {
  const { deps, summary } = args;
  const pick = await deps.window.showWarningMessage(
    summary.line,
    SHOW_SUMMARY_LABEL,
    CANCEL_LABEL,
  );
  if (pick === SHOW_SUMMARY_LABEL) {
    deps.log.show(true);
  }
}

async function promptComplete(args: {
  deps: FinalizeDeps;
  summary: RenderedSummary;
}): Promise<void> {
  const { deps, summary } = args;
  const pick = await deps.window.showInformationMessage(
    summary.line,
    COPY_COMMAND_LABEL,
  );
  if (pick === COPY_COMMAND_LABEL) {
    await deps.clipboard.writeText(summary.cliCommand);
    await deps.window.showInformationMessage(COPIED_MESSAGE);
  }
}

function isEnoent(err: unknown): boolean {
  if (err === null || typeof err !== 'object') {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  return code === 'ENOENT';
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? `${err.name}: ${err.message}`;
  }
  return String(err);
}

function buildDefaultLog(): FinalizeLog {
  const channel = defaultGetOutputChannel();
  return {
    info: (msg) => channel.appendLine(`[info] ${msg}`),
    warn: (msg) => channel.appendLine(`[warn] ${msg}`),
    error: (msg) => channel.appendLine(`[error] ${msg}`),
    appendLine: (msg) => channel.appendLine(msg),
    show: (preserveFocus) => channel.show(preserveFocus ?? false),
  };
}

async function defaultStat(filePath: string): Promise<{ mtimeMs: number }> {
  const s = await fsStat(filePath);
  return { mtimeMs: s.mtimeMs };
}

function defaultReadFile(filePath: string): Promise<string> {
  return fsReadFile(filePath, 'utf8');
}

function defaultSha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex').slice(0, 8);
}

export type { LoadedFindings, StatusCounts };
