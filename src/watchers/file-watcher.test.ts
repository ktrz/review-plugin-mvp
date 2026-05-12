import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { createFindingsWatcher, type CreateWatcher } from './file-watcher';

type Listener = (uri: vscode.Uri) => unknown;

function makeFakeWatcher(): {
  watcher: vscode.FileSystemWatcher;
  handlers: { change: Listener[]; create: Listener[]; delete: Listener[] };
  subscriptionDisposes: Array<ReturnType<typeof vi.fn>>;
} {
  const handlers: { change: Listener[]; create: Listener[]; delete: Listener[] } = {
    change: [],
    create: [],
    delete: [],
  };
  const subscriptionDisposes: Array<ReturnType<typeof vi.fn>> = [];
  const makeRegistrar = (kind: 'change' | 'create' | 'delete') =>
    vi.fn((cb: Listener) => {
      handlers[kind].push(cb);
      const dispose = vi.fn();
      subscriptionDisposes.push(dispose);
      return { dispose };
    });

  const watcher: vscode.FileSystemWatcher = {
    onDidChange: makeRegistrar('change'),
    onDidCreate: makeRegistrar('create'),
    onDidDelete: makeRegistrar('delete'),
    dispose: vi.fn(),
    ignoreCreateEvents: false,
    ignoreChangeEvents: false,
    ignoreDeleteEvents: false,
  };
  return { watcher, handlers, subscriptionDisposes };
}

describe('createFindingsWatcher', () => {
  const filePath = '/repo/plans.local/repo/pr-42-auto-review.md';

  it('builds a RelativePattern from the file path dirname/basename', () => {
    const { watcher } = makeFakeWatcher();
    const createWatcher: CreateWatcher = vi.fn(() => watcher);
    const onReload = vi.fn();
    const onDelete = vi.fn();

    createFindingsWatcher({ filePath, onReload, onDelete, createWatcher });

    expect(createWatcher).toHaveBeenCalledTimes(1);
    const pattern = vi.mocked(createWatcher).mock.calls[0]![0];
    expect(pattern).toBeInstanceOf(vscode.RelativePattern);
    expect(pattern.pattern).toBe(path.basename(filePath));
    // `@types/vscode` declares `RelativePattern.base` as `string`, but the
    // runtime shim widens it to the original Uri (per `test/vscode-shim.ts`).
    // Step through `{ base: unknown }` (a real supertype of the @types view)
    // to read the shim's actual stored Uri without a banned `as unknown as`.
    const baseHolder: { base: unknown } = pattern;
    const baseUri = baseHolder.base as { fsPath: string };
    expect(baseUri.fsPath).toBe(path.dirname(filePath));
  });

  it('wires onDidChange and onDidCreate to onReload', () => {
    const { watcher, handlers } = makeFakeWatcher();
    const createWatcher: CreateWatcher = vi.fn(() => watcher);
    const onReload = vi.fn();
    const onDelete = vi.fn();

    createFindingsWatcher({ filePath, onReload, onDelete, createWatcher });

    expect(watcher.onDidChange).toHaveBeenCalledTimes(1);
    expect(watcher.onDidCreate).toHaveBeenCalledTimes(1);
    expect(watcher.onDidDelete).toHaveBeenCalledTimes(1);

    handlers.change[0]?.(vscode.Uri.file(filePath));
    handlers.create[0]?.(vscode.Uri.file(filePath));
    expect(onReload).toHaveBeenCalledTimes(2);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('wires onDidDelete to onDelete', () => {
    const { watcher, handlers } = makeFakeWatcher();
    const createWatcher: CreateWatcher = vi.fn(() => watcher);
    const onReload = vi.fn();
    const onDelete = vi.fn();

    createFindingsWatcher({ filePath, onReload, onDelete, createWatcher });

    handlers.delete[0]?.(vscode.Uri.file(filePath));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onReload).not.toHaveBeenCalled();
  });

  it('returned disposable disposes the watcher and all event subscriptions', () => {
    const { watcher, subscriptionDisposes } = makeFakeWatcher();
    const createWatcher: CreateWatcher = vi.fn(() => watcher);
    const disposable = createFindingsWatcher({
      filePath,
      onReload: vi.fn(),
      onDelete: vi.fn(),
      createWatcher,
    });

    disposable.dispose();

    expect(watcher.dispose).toHaveBeenCalledTimes(1);
    expect(subscriptionDisposes).toHaveLength(3);
    for (const dispose of subscriptionDisposes) {
      expect(dispose).toHaveBeenCalledTimes(1);
    }
  });

  it('default createWatcher delegates to vscode.workspace.createFileSystemWatcher', () => {
    const { watcher } = makeFakeWatcher();
    const createSpy: typeof vscode.workspace.createFileSystemWatcher = vi.fn(() => watcher);
    vi.mocked(vscode.workspace.createFileSystemWatcher).mockImplementation(createSpy);

    createFindingsWatcher({
      filePath,
      onReload: vi.fn(),
      onDelete: vi.fn(),
    });

    expect(createSpy).toHaveBeenCalledTimes(1);
    const pattern = vi.mocked(createSpy).mock.calls[0]![0];
    expect(pattern).toBeInstanceOf(vscode.RelativePattern);
    expect((pattern as vscode.RelativePattern).pattern).toBe(path.basename(filePath));
  });
});
