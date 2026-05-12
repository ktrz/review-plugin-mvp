import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { createFindingsWatcher } from './file-watcher';

type Listener = (uri: unknown) => unknown;

function makeFakeWatcher() {
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

  const watcher = {
    onDidChange: makeRegistrar('change'),
    onDidCreate: makeRegistrar('create'),
    onDidDelete: makeRegistrar('delete'),
    dispose: vi.fn(),
  };
  return { watcher, handlers, subscriptionDisposes };
}

describe('createFindingsWatcher', () => {
  const filePath = '/repo/plans.local/repo/pr-42-auto-review.md';

  it('builds a RelativePattern from the file path dirname/basename', () => {
    const { watcher } = makeFakeWatcher();
    const createWatcher = vi.fn(() => watcher) as unknown as (
      pattern: vscode.RelativePattern,
    ) => vscode.FileSystemWatcher;
    const onReload = vi.fn();
    const onDelete = vi.fn();

    createFindingsWatcher({ filePath, onReload, onDelete, createWatcher });

    expect(createWatcher).toHaveBeenCalledTimes(1);
    const pattern = (createWatcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(pattern).toBeInstanceOf(vscode.RelativePattern);
    expect(pattern.pattern).toBe(path.basename(filePath));
    const baseUri = pattern.base as { fsPath: string };
    expect(baseUri.fsPath).toBe(path.dirname(filePath));
  });

  it('wires onDidChange and onDidCreate to onReload', () => {
    const { watcher, handlers } = makeFakeWatcher();
    const createWatcher = vi.fn(() => watcher) as unknown as (
      pattern: vscode.RelativePattern,
    ) => vscode.FileSystemWatcher;
    const onReload = vi.fn();
    const onDelete = vi.fn();

    createFindingsWatcher({ filePath, onReload, onDelete, createWatcher });

    expect(watcher.onDidChange).toHaveBeenCalledTimes(1);
    expect(watcher.onDidCreate).toHaveBeenCalledTimes(1);
    expect(watcher.onDidDelete).toHaveBeenCalledTimes(1);

    handlers.change[0]?.({ fsPath: filePath });
    handlers.create[0]?.({ fsPath: filePath });
    expect(onReload).toHaveBeenCalledTimes(2);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('wires onDidDelete to onDelete', () => {
    const { watcher, handlers } = makeFakeWatcher();
    const createWatcher = vi.fn(() => watcher) as unknown as (
      pattern: vscode.RelativePattern,
    ) => vscode.FileSystemWatcher;
    const onReload = vi.fn();
    const onDelete = vi.fn();

    createFindingsWatcher({ filePath, onReload, onDelete, createWatcher });

    handlers.delete[0]?.({ fsPath: filePath });
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onReload).not.toHaveBeenCalled();
  });

  it('returned disposable disposes the watcher and all event subscriptions', () => {
    const { watcher, subscriptionDisposes } = makeFakeWatcher();
    const createWatcher = vi.fn(() => watcher) as unknown as (
      pattern: vscode.RelativePattern,
    ) => vscode.FileSystemWatcher;
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
    const createSpy = vi.fn((_pattern: vscode.RelativePattern) => watcher);
    (vscode.workspace.createFileSystemWatcher as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      createSpy,
    );

    createFindingsWatcher({
      filePath,
      onReload: vi.fn(),
      onDelete: vi.fn(),
    });

    expect(createSpy).toHaveBeenCalledTimes(1);
    const pattern = createSpy.mock.calls[0][0];
    expect(pattern).toBeInstanceOf(vscode.RelativePattern);
    expect(pattern.pattern).toBe(path.basename(filePath));
  });
});
