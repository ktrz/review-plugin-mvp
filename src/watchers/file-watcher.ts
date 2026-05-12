import path from 'node:path';
import * as vscode from 'vscode';

export type CreateWatcher = (pattern: vscode.RelativePattern) => vscode.FileSystemWatcher;

export type CreateFindingsWatcherDeps = {
  filePath: string;
  onReload: () => void;
  onDelete: () => void;
  createWatcher?: CreateWatcher;
};

const defaultCreateWatcher: CreateWatcher = (pattern) =>
  vscode.workspace.createFileSystemWatcher(pattern);

export function createFindingsWatcher(deps: CreateFindingsWatcherDeps): vscode.Disposable {
  const { filePath, onReload, onDelete, createWatcher = defaultCreateWatcher } = deps;

  const dir = path.dirname(filePath);
  const basename = path.basename(filePath);
  const pattern = new vscode.RelativePattern(vscode.Uri.file(dir), basename);

  const watcher = createWatcher(pattern);
  const subscriptions: vscode.Disposable[] = [
    watcher.onDidChange(() => onReload()),
    watcher.onDidCreate(() => onReload()),
    watcher.onDidDelete(() => onDelete()),
  ];

  return {
    dispose(): void {
      for (const sub of subscriptions) {
        sub.dispose();
      }
      watcher.dispose();
    },
  };
}
