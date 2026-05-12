import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  __resetActiveWatcherForTests,
  disposeActiveWatcher,
  loadFindingsHandler,
  registerLoadFindingsCommand,
  type LoadDeps,
} from './load-findings';
import { clearState, getState, setOutputChannel } from '../runtime/findings-state';
import { ParseError } from '../schema';
import type { HandoverDocument } from '../schema';

const WORKSPACE = '/tmp/repo';

function setWorkspaceFolders(
  folders: ReadonlyArray<{ uri: { fsPath: string }; name: string; index: number }> | undefined,
): void {
  const ws = vscode.workspace as { workspaceFolders: typeof folders };
  ws.workspaceFolders = folders;
}

const makeDoc = (): HandoverDocument =>
  ({
    header: { pr: 42 },
    items: [{ id: 'one' }, { id: 'two' }],
  }) as unknown as HandoverDocument;

const makeChannel = () => {
  const channel: Partial<vscode.OutputChannel> = {
    name: 'Review Plugin',
    appendLine: vi.fn(),
    append: vi.fn(),
    clear: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    replace: vi.fn(),
  };
  return channel as vscode.OutputChannel;
};

type WatcherCallbacks = {
  onReload: () => unknown;
  onDelete: () => unknown;
};

function makeDeps(overrides: Partial<LoadDeps> = {}) {
  const watcherDispose = vi.fn();
  const watcherCallbacks: WatcherCallbacks = {
    onReload: () => {},
    onDelete: () => {},
  };
  const channel = overrides.getOutputChannel ? overrides.getOutputChannel() : makeChannel();
  const showError = vi.fn();
  const loadFindingsFile = vi.fn(async () => ({ doc: makeDoc(), mtime: 999 }));
  const createFindingsWatcher = vi.fn(
    (args: { onReload: () => unknown; onDelete: () => unknown }) => {
      watcherCallbacks.onReload = args.onReload;
      watcherCallbacks.onDelete = args.onDelete;
      return { dispose: watcherDispose };
    },
  );

  const deps: LoadDeps = {
    workspaceRoot: WORKSPACE,
    discoverPrNumber: vi.fn(async () => 42),
    resolveFindingsPath: vi.fn(async () => '/tmp/repo/pr-42-auto-review.md'),
    loadFindingsFile: loadFindingsFile as unknown as LoadDeps['loadFindingsFile'],
    createFindingsWatcher: createFindingsWatcher as unknown as LoadDeps['createFindingsWatcher'],
    getOutputChannel: () => channel,
    showError,
    ...overrides,
  };

  return { deps, watcherDispose, watcherCallbacks, showError, channel, loadFindingsFile };
}

describe('loadFindingsHandler', () => {
  beforeEach(() => {
    clearState();
    __resetActiveWatcherForTests();
    setOutputChannel(makeChannel());
  });

  afterEach(() => {
    disposeActiveWatcher();
    clearState();
    __resetActiveWatcherForTests();
  });

  it('runs the full happy path: discover → resolve → load → setState → watcher', async () => {
    const { deps, channel, watcherDispose: _wd } = makeDeps();
    void _wd;

    await loadFindingsHandler(deps);

    expect(deps.discoverPrNumber).toHaveBeenCalledWith({ workspaceRoot: WORKSPACE });
    expect(deps.resolveFindingsPath).toHaveBeenCalledWith({
      workspaceRoot: WORKSPACE,
      prNumber: 42,
    });
    expect(deps.loadFindingsFile).toHaveBeenCalledWith('/tmp/repo/pr-42-auto-review.md');
    expect(deps.createFindingsWatcher).toHaveBeenCalledTimes(1);

    const state = getState();
    expect(state).not.toBeNull();
    expect(state?.prNumber).toBe(42);
    expect(state?.filePath).toBe('/tmp/repo/pr-42-auto-review.md');
    expect(state?.mtime).toBe(999);

    expect(channel.appendLine).toHaveBeenCalledWith(
      expect.stringContaining('Loaded 2 findings from /tmp/repo/pr-42-auto-review.md'),
    );
    expect(channel.appendLine).toHaveBeenCalledWith(
      expect.stringContaining('"id": "one"'),
    );
  });

  it('aborts when discoverPrNumber returns null and logs to channel', async () => {
    const { deps, channel, showError } = makeDeps({
      discoverPrNumber: vi.fn(async () => null),
    });

    await loadFindingsHandler(deps);

    expect(channel.appendLine).toHaveBeenCalledWith(
      'PR number not provided — aborting load.',
    );
    expect(deps.resolveFindingsPath).not.toHaveBeenCalled();
    expect(deps.loadFindingsFile).not.toHaveBeenCalled();
    expect(deps.createFindingsWatcher).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
    expect(getState()).toBeNull();
  });

  it('aborts when resolveFindingsPath returns null and logs to channel', async () => {
    const { deps, channel, showError } = makeDeps({
      resolveFindingsPath: vi.fn(async () => null),
    });

    await loadFindingsHandler(deps);

    expect(channel.appendLine).toHaveBeenCalledWith(
      'No findings file selected — aborting load.',
    );
    expect(deps.loadFindingsFile).not.toHaveBeenCalled();
    expect(deps.createFindingsWatcher).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
    expect(getState()).toBeNull();
  });

  it('on loader ParseError: logs full error, shows toast, clears state, disposes watcher', async () => {
    const parseError = new ParseError('broken header', 0, 'IN_HEADER', 12);
    const { deps, channel, showError } = makeDeps({
      loadFindingsFile: vi.fn(async () => {
        throw parseError;
      }) as unknown as LoadDeps['loadFindingsFile'],
    });

    await loadFindingsHandler(deps);

    expect(channel.appendLine).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load findings'),
    );
    expect(channel.appendLine).toHaveBeenCalledWith(expect.stringContaining('IN_HEADER'));
    expect(showError).toHaveBeenCalledWith(
      'Failed to load findings — see Review Plugin output.',
    );
    expect(getState()).toBeNull();
    expect(deps.createFindingsWatcher).not.toHaveBeenCalled();
  });

  it('disposes the previous watcher when invoked twice', async () => {
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();
    const createWatcher = vi
      .fn()
      .mockImplementationOnce(() => ({ dispose: firstDispose }))
      .mockImplementationOnce(() => ({ dispose: secondDispose }));
    const { deps } = makeDeps({
      createFindingsWatcher: createWatcher as unknown as LoadDeps['createFindingsWatcher'],
    });

    await loadFindingsHandler(deps);
    await loadFindingsHandler(deps);

    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(secondDispose).not.toHaveBeenCalled();
  });

  it('on load failure after a successful load: clears state and disposes prior watcher', async () => {
    const firstDispose = vi.fn();
    const createWatcher = vi.fn(() => ({ dispose: firstDispose }));
    const loadFindingsFile = vi
      .fn()
      .mockResolvedValueOnce({ doc: makeDoc(), mtime: 1 })
      .mockRejectedValueOnce(new ParseError('bad body', 0, 'BETWEEN_ITEMS', 4));

    const { deps, channel, showError } = makeDeps({
      createFindingsWatcher: createWatcher as unknown as LoadDeps['createFindingsWatcher'],
      loadFindingsFile: loadFindingsFile as unknown as LoadDeps['loadFindingsFile'],
    });

    await loadFindingsHandler(deps);
    expect(getState()).not.toBeNull();

    await loadFindingsHandler(deps);

    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(getState()).toBeNull();
    expect(showError).toHaveBeenCalledWith(
      'Failed to load findings — see Review Plugin output.',
    );
    expect(channel.appendLine).toHaveBeenCalledWith(
      expect.stringContaining('BETWEEN_ITEMS'),
    );
  });

  it('watcher onReload re-invokes loader and updates state without re-prompting PR or path', async () => {
    const docA = makeDoc();
    const docB = makeDoc();
    const loadFindingsFile = vi
      .fn()
      .mockResolvedValueOnce({ doc: docA, mtime: 100 })
      .mockResolvedValueOnce({ doc: docB, mtime: 200 });

    const { deps, watcherCallbacks, channel } = makeDeps({
      loadFindingsFile: loadFindingsFile as unknown as LoadDeps['loadFindingsFile'],
    });

    await loadFindingsHandler(deps);
    expect(getState()?.mtime).toBe(100);
    expect(getState()?.doc).toBe(docA);
    const channelAppend = channel.appendLine as ReturnType<typeof vi.fn>;
    channelAppend.mockClear();
    (deps.discoverPrNumber as ReturnType<typeof vi.fn>).mockClear();
    (deps.resolveFindingsPath as ReturnType<typeof vi.fn>).mockClear();

    await watcherCallbacks.onReload();

    expect(deps.discoverPrNumber).not.toHaveBeenCalled();
    expect(deps.resolveFindingsPath).not.toHaveBeenCalled();
    expect(loadFindingsFile).toHaveBeenCalledTimes(2);
    expect(getState()?.mtime).toBe(200);
    expect(getState()?.doc).toBe(docB);
    expect(channelAppend).toHaveBeenCalledWith(
      expect.stringContaining('Loaded 2 findings from /tmp/repo/pr-42-auto-review.md'),
    );
  });

  it('watcher onReload surfaces loader errors via toast + channel and clears state', async () => {
    const loadFindingsFile = vi
      .fn()
      .mockResolvedValueOnce({ doc: makeDoc(), mtime: 1 })
      .mockRejectedValueOnce(new ParseError('bad header', 0, 'IN_HEADER', 1));

    const { deps, watcherCallbacks, channel, showError } = makeDeps({
      loadFindingsFile: loadFindingsFile as unknown as LoadDeps['loadFindingsFile'],
    });

    await loadFindingsHandler(deps);
    expect(getState()).not.toBeNull();
    showError.mockClear();
    (channel.appendLine as ReturnType<typeof vi.fn>).mockClear();

    await watcherCallbacks.onReload();

    expect(showError).toHaveBeenCalledWith(
      'Failed to load findings — see Review Plugin output.',
    );
    expect(channel.appendLine).toHaveBeenCalledWith(expect.stringContaining('IN_HEADER'));
    expect(getState()).toBeNull();
  });

  it('watcher onDelete clears state, disposes watcher, logs to channel', async () => {
    const { deps, watcherCallbacks, watcherDispose, channel } = makeDeps();

    await loadFindingsHandler(deps);
    expect(getState()).not.toBeNull();

    watcherCallbacks.onDelete();

    expect(getState()).toBeNull();
    expect(watcherDispose).toHaveBeenCalledTimes(1);
    expect(channel.appendLine).toHaveBeenCalledWith(
      'Findings file deleted — state cleared.',
    );
  });
});

describe('registerLoadFindingsCommand', () => {
  beforeEach(() => {
    clearState();
    __resetActiveWatcherForTests();
    setOutputChannel(makeChannel());
  });

  afterEach(() => {
    disposeActiveWatcher();
    __resetActiveWatcherForTests();
  });

  it('registers the reviewPlugin.loadFindings command and pushes disposables', () => {
    const subscriptions: vscode.Disposable[] = [];
    const context = { subscriptions } as unknown as vscode.ExtensionContext;
    const commandDispose = vi.fn();
    (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mockReturnValue({
      dispose: commandDispose,
    });
    setWorkspaceFolders([{ uri: { fsPath: WORKSPACE }, name: 'repo', index: 0 }]);

    registerLoadFindingsCommand(context);

    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      'reviewPlugin.loadFindings',
      expect.any(Function),
    );
    expect(subscriptions.length).toBeGreaterThanOrEqual(2);
  });

  it('shows an error toast and aborts when no workspace folder is open', async () => {
    const subscriptions: vscode.Disposable[] = [];
    const context = { subscriptions } as unknown as vscode.ExtensionContext;
    let captured: (() => Promise<void>) | null = null;
    (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mockImplementation(
      (_id: string, cb: () => Promise<void>) => {
        captured = cb;
        return { dispose: vi.fn() };
      },
    );
    setWorkspaceFolders(undefined);

    registerLoadFindingsCommand(context);
    expect(captured).not.toBeNull();
    await captured!();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No workspace folder open.');
  });
});

describe('disposeActiveWatcher', () => {
  beforeEach(() => {
    __resetActiveWatcherForTests();
    setOutputChannel(makeChannel());
  });

  it('is a no-op when no watcher is active', () => {
    expect(() => disposeActiveWatcher()).not.toThrow();
  });

  it('disposes the active watcher and forgets it', async () => {
    const dispose = vi.fn();
    const { deps } = makeDeps({
      createFindingsWatcher: vi.fn(() => ({ dispose })) as unknown as LoadDeps['createFindingsWatcher'],
    });
    await loadFindingsHandler(deps);

    disposeActiveWatcher();
    disposeActiveWatcher();

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
