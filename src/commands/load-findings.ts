import { createHash, randomUUID } from 'node:crypto';
import { readFile as fsReadFile } from 'node:fs/promises';
import * as vscode from 'vscode';
import { discoverPrNumber as defaultDiscoverPrNumber } from '../pr-discovery/gh-runner';
import { resolveFindingsPath as defaultResolveFindingsPath } from '../loaders/path-resolver';
import { loadFindingsFile as defaultLoadFindingsFile } from '../loaders/file-loader';
import { createFindingsWatcher as defaultCreateFindingsWatcher } from '../watchers/file-watcher';
import {
  clearState,
  getOutputChannel as defaultGetOutputChannel,
  setState,
} from '../runtime/findings-state';
import { renderFindings as defaultRenderFindings } from '../comments/renderer';
import {
  disposeAll as defaultDisposeActiveThreads,
  setActiveEntries as defaultSetActiveEntries,
} from '../comments/render-session';
import {
  serializeDocument,
  stampMissingIds,
  type HandoverDocument,
} from '../schema';
import type { FindingsWriter } from '../runtime/findings-writer';

export type LoadDeps = {
  workspaceRoot: string;
  discoverPrNumber: typeof defaultDiscoverPrNumber;
  resolveFindingsPath: typeof defaultResolveFindingsPath;
  loadFindingsFile: typeof defaultLoadFindingsFile;
  createFindingsWatcher: typeof defaultCreateFindingsWatcher;
  getOutputChannel: () => vscode.OutputChannel;
  showError: (msg: string) => Thenable<string | undefined> | void;
  controller: vscode.CommentController;
  renderFindings: typeof defaultRenderFindings;
  setActiveEntries: typeof defaultSetActiveEntries;
  disposeActiveThreads: typeof defaultDisposeActiveThreads;
  writer: FindingsWriter;
  generateId: () => string;
  readFile: (filePath: string) => Promise<string>;
  sha256: (data: string) => string;
};

export type LoadExtras = Pick<LoadDeps, 'controller' | 'writer'>;

const PARSE_ERROR_TOAST = 'Failed to load findings — see Review Plugin output.';

let activeWatcher: vscode.Disposable | null = null;

export function disposeActiveWatcher(): void {
  if (activeWatcher === null) {return;}
  activeWatcher.dispose();
  activeWatcher = null;
}

export function __resetActiveWatcherForTests(): void {
  activeWatcher = null;
}

export async function loadFindingsHandler(deps: LoadDeps): Promise<void> {
  const channel = deps.getOutputChannel();

  const prNumber = await deps.discoverPrNumber({ workspaceRoot: deps.workspaceRoot });
  if (prNumber === null) {
    channel.appendLine('PR number not provided — aborting load.');
    return;
  }

  const filePath = await deps.resolveFindingsPath({
    workspaceRoot: deps.workspaceRoot,
    prNumber,
  });
  if (filePath === null) {
    channel.appendLine('No findings file selected — aborting load.');
    return;
  }

  const loaded = await runLoaderWithErrorSurface({
    deps,
    channel,
    filePath,
    contextLabel: 'load',
  });
  if (loaded === null) {return;}

  const stamped = await stampAndPersist({
    deps,
    channel,
    filePath,
    doc: loaded.doc,
    mtime: loaded.mtime,
  });
  if (stamped === null) {return;}

  setState({
    doc: stamped.doc,
    mtime: stamped.mtime,
    filePath,
    prNumber,
    lastWriteSha: stamped.lastWriteSha,
  });
  setHasFindingsContext(true);
  renderAndLog({ deps, channel, filePath, doc: stamped.doc });

  disposeActiveWatcher();
  activeWatcher = deps.createFindingsWatcher({
    filePath,
    onReload: () => reloadFromWatcher({ deps, channel, filePath, prNumber }),
    onDelete: () => handleDelete({ deps, channel }),
  });
}

interface StampAndPersistArgs {
  deps: LoadDeps;
  channel: vscode.OutputChannel;
  filePath: string;
  doc: Readonly<HandoverDocument>;
  mtime: number;
}

interface StampAndPersistResult {
  doc: Readonly<HandoverDocument>;
  mtime: number;
  lastWriteSha: string | undefined;
}

async function stampAndPersist(
  args: StampAndPersistArgs,
): Promise<StampAndPersistResult | null> {
  const { deps, channel, filePath, doc, mtime } = args;
  const stampedDoc = stampMissingIds(doc, { generateId: deps.generateId });
  if (stampedDoc === doc) {
    return { doc, mtime, lastWriteSha: undefined };
  }
  try {
    const serialized = serializeDocument(stampedDoc);
    const { mtime: newMtime, sha } = await deps.writer.write(filePath, serialized);
    channel.appendLine(
      `Stamped missing ids and wrote findings back to ${filePath}.`,
    );
    return { doc: stampedDoc, mtime: newMtime, lastWriteSha: sha };
  } catch (err) {
    channel.appendLine(`Failed to write stamped findings to ${filePath}:`);
    channel.appendLine(formatError(err));
    deps.showError(PARSE_ERROR_TOAST);
    clearState();
    setHasFindingsContext(false);
    deps.disposeActiveThreads();
    disposeActiveWatcher();
    return null;
  }
}

interface RunLoaderArgs {
  deps: LoadDeps;
  channel: vscode.OutputChannel;
  filePath: string;
  contextLabel: 'load' | 'reload';
}

async function runLoaderWithErrorSurface(
  args: RunLoaderArgs,
): Promise<{ doc: Awaited<ReturnType<typeof defaultLoadFindingsFile>>['doc']; mtime: number } | null> {
  const { deps, channel, filePath, contextLabel } = args;
  try {
    return await deps.loadFindingsFile(filePath);
  } catch (err) {
    channel.appendLine(`Failed to load findings (${contextLabel}) from ${filePath}:`);
    channel.appendLine(formatError(err));
    deps.showError(PARSE_ERROR_TOAST);
    clearState();
    setHasFindingsContext(false);
    deps.disposeActiveThreads();
    disposeActiveWatcher();
    return null;
  }
}

interface ReloadArgs {
  deps: LoadDeps;
  channel: vscode.OutputChannel;
  filePath: string;
  prNumber: number;
}

function handleDelete(args: { deps: LoadDeps; channel: vscode.OutputChannel }): void {
  const { deps, channel } = args;
  clearState();
  setHasFindingsContext(false);
  deps.disposeActiveThreads();
  disposeActiveWatcher();
  channel.appendLine('Findings file deleted — state cleared.');
}

async function reloadFromWatcher(args: ReloadArgs): Promise<void> {
  const { deps, channel, filePath, prNumber } = args;
  const lastWriteSha = deps.writer.getLastWriteSha(filePath);
  let diskSha: string | null = null;
  if (lastWriteSha !== undefined) {
    diskSha = await tryComputeDiskSha({ deps, channel, filePath });
    if (diskSha !== null && diskSha === lastWriteSha) {
      channel.appendLine(
        `Self-write detected for ${filePath} — skipping reload.`,
      );
      return;
    }
  }
  const loaded = await runLoaderWithErrorSurface({
    deps,
    channel,
    filePath,
    contextLabel: 'reload',
  });
  if (loaded === null) {return;}
  setState({
    doc: loaded.doc,
    mtime: loaded.mtime,
    filePath,
    prNumber,
    lastWriteSha: diskSha ?? undefined,
  });
  renderAndLog({ deps, channel, filePath, doc: loaded.doc });
}

interface TryComputeDiskShaArgs {
  deps: LoadDeps;
  channel: vscode.OutputChannel;
  filePath: string;
}

async function tryComputeDiskSha(
  args: TryComputeDiskShaArgs,
): Promise<string | null> {
  const { deps, channel, filePath } = args;
  try {
    const raw = await deps.readFile(filePath);
    return deps.sha256(raw);
  } catch (err) {
    channel.appendLine(
      `Self-write check failed for ${filePath} — falling through to reload: ${formatError(err)}`,
    );
    return null;
  }
}

interface RenderAndLogArgs {
  deps: LoadDeps;
  channel: vscode.OutputChannel;
  filePath: string;
  doc: Awaited<ReturnType<typeof defaultLoadFindingsFile>>['doc'];
}

function renderAndLog(args: RenderAndLogArgs): void {
  const { deps, channel, filePath, doc } = args;
  channel.appendLine(`Loaded ${doc.items.length} findings from ${filePath}.`);
  const { fileEntries, skippedPrLevel } = deps.renderFindings({
    doc,
    controller: deps.controller,
    workspaceRoot: deps.workspaceRoot,
  });
  deps.setActiveEntries(fileEntries);
  channel.appendLine(`Rendered ${fileEntries.length} inline thread(s).`);
  if (skippedPrLevel > 0) {
    channel.appendLine(
      `Skipped ${skippedPrLevel} PR-level finding(s) — inline rendering deferred to a later phase.`,
    );
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    const extras = Object.entries(err)
      .filter(([k]) => k !== 'name' && k !== 'message' && k !== 'stack')
      .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
      .join('\n');
    const stack = err.stack ?? `${err.name}: ${err.message}`;
    return extras.length > 0 ? `${stack}\n${extras}` : stack;
  }
  return String(err);
}

export function registerLoadFindingsCommand(
  context: vscode.ExtensionContext,
  extras: LoadExtras,
): void {
  const handler = async (): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder === undefined) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }
    const deps: LoadDeps = {
      workspaceRoot: folder.uri.fsPath,
      discoverPrNumber: defaultDiscoverPrNumber,
      resolveFindingsPath: defaultResolveFindingsPath,
      loadFindingsFile: defaultLoadFindingsFile,
      createFindingsWatcher: defaultCreateFindingsWatcher,
      getOutputChannel: defaultGetOutputChannel,
      showError: (msg) => vscode.window.showErrorMessage(msg),
      controller: extras.controller,
      renderFindings: defaultRenderFindings,
      setActiveEntries: defaultSetActiveEntries,
      disposeActiveThreads: defaultDisposeActiveThreads,
      writer: extras.writer,
      generateId: () => randomUUID(),
      readFile: (p) => fsReadFile(p, 'utf8'),
      sha256: defaultLoadShaSha256,
    };
    await loadFindingsHandler(deps);
  };

  const commandDisposable = vscode.commands.registerCommand(
    'reviewPlugin.loadFindings',
    handler,
  );
  context.subscriptions.push(commandDisposable);
  context.subscriptions.push({
    dispose: () => disposeActiveWatcher(),
  });
}

function defaultLoadShaSha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex').slice(0, 8);
}

function setHasFindingsContext(value: boolean): void {
  vscode.commands.executeCommand('setContext', 'reviewPlugin.hasFindings', value);
}
