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

export type LoadDeps = {
  workspaceRoot: string;
  discoverPrNumber: typeof defaultDiscoverPrNumber;
  resolveFindingsPath: typeof defaultResolveFindingsPath;
  loadFindingsFile: typeof defaultLoadFindingsFile;
  createFindingsWatcher: typeof defaultCreateFindingsWatcher;
  getOutputChannel: () => vscode.OutputChannel;
  showError: (msg: string) => Thenable<string | undefined> | void;
};

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

  setState({ doc: loaded.doc, mtime: loaded.mtime, filePath, prNumber });
  logLoadedSummary(channel, loaded.doc.items.length, filePath, loaded.doc);

  disposeActiveWatcher();
  activeWatcher = deps.createFindingsWatcher({
    filePath,
    onReload: () => reloadFromWatcher({ deps, channel, filePath, prNumber }),
    onDelete: () => handleDelete(channel),
  });
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

function handleDelete(channel: vscode.OutputChannel): void {
  clearState();
  disposeActiveWatcher();
  channel.appendLine('Findings file deleted — state cleared.');
}

async function reloadFromWatcher(args: ReloadArgs): Promise<void> {
  const { deps, channel, filePath, prNumber } = args;
  const loaded = await runLoaderWithErrorSurface({
    deps,
    channel,
    filePath,
    contextLabel: 'reload',
  });
  if (loaded === null) {return;}
  setState({ doc: loaded.doc, mtime: loaded.mtime, filePath, prNumber });
  logLoadedSummary(channel, loaded.doc.items.length, filePath, loaded.doc);
}

function logLoadedSummary(
  channel: vscode.OutputChannel,
  itemCount: number,
  filePath: string,
  doc: unknown,
): void {
  channel.appendLine(`Loaded ${itemCount} findings from ${filePath}.`);
  channel.appendLine(JSON.stringify(doc, null, 2));
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

export function registerLoadFindingsCommand(context: vscode.ExtensionContext): void {
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
