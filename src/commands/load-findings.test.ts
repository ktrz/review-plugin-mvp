import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  __resetActiveWatcherForTests,
  disposeActiveWatcher,
  loadFindingsHandler,
  registerLoadFindingsCommand,
  type LoadDeps,
  type LoadExtras,
} from './load-findings';
import { clearState, getState, setOutputChannel } from '../runtime/findings-state';
import { HandoverDocumentSchema, ParseError, type HandoverDocument } from '../schema';
import type { RenderFindingsDeps, RenderFindingsResult } from '../comments/renderer';

const WORKSPACE = '/tmp/repo';

function setWorkspaceFolders(
  folders: ReadonlyArray<{ uri: { fsPath: string }; name: string; index: number }> | undefined,
): void {
  const ws = vscode.workspace as { workspaceFolders: typeof folders };
  ws.workspaceFolders = folders;
}

const makeFindingItemInput = (commentTag: string) => ({
  status: 'unresolved',
  source: { kind: 'auto-review', severity: 'important' },
  location: { kind: 'file', file: 'src/x.ts', line: 1 },
  reportedBy: ['auto-review'],
  comment: `comment-${commentTag}`,
  analysis: `analysis-${commentTag}`,
  recommendation: `recommendation-${commentTag}`,
  options: [`option-${commentTag}`],
  resolution: '',
  dirty: false,
  rawSource: `raw-${commentTag}`,
});

const makeDoc = (): HandoverDocument =>
  HandoverDocumentSchema.parse({
    header: {
      prUrl: 'https://github.com/octo/repo/pull/42',
      prNumber: 42,
      branch: {
        head: { ref: 'feat/x' },
        base: { ref: 'main' },
      },
      generatedAt: '2026-01-01T00:00:00Z',
      status: 'PENDING REVIEW',
    },
    items: [makeFindingItemInput('one'), makeFindingItemInput('two')],
  });

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

const makeFakeController = (): vscode.CommentController => {
  const fake: Partial<vscode.CommentController> = {
    id: 'reviewPlugin.findings',
    label: 'Review Plugin',
    createCommentThread: vi.fn(),
    dispose: vi.fn(),
  };
  return fake as vscode.CommentController;
};

const makeFakeThread = (label = 'fake'): vscode.CommentThread => {
  const fake: Partial<vscode.CommentThread> = {
    label,
    contextValue: 'review-finding',
    canReply: false,
    dispose: vi.fn(),
  };
  return fake as vscode.CommentThread;
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

  const controller = makeFakeController();
  const renderResult: RenderFindingsResult = {
    fileThreads: [makeFakeThread('t1'), makeFakeThread('t2')],
    skippedPrLevel: 0,
  };
  const renderFindings = vi.fn(
    (_d: RenderFindingsDeps): RenderFindingsResult => renderResult,
  );
  const setActiveThreads = vi.fn();
  const disposeActiveThreads = vi.fn();

  const deps: LoadDeps = {
    workspaceRoot: WORKSPACE,
    discoverPrNumber: vi.fn(async () => 42),
    resolveFindingsPath: vi.fn(async () => '/tmp/repo/pr-42-auto-review.md'),
    loadFindingsFile: loadFindingsFile as LoadDeps['loadFindingsFile'],
    createFindingsWatcher: createFindingsWatcher as LoadDeps['createFindingsWatcher'],
    getOutputChannel: () => channel,
    showError,
    controller,
    renderFindings: renderFindings as LoadDeps['renderFindings'],
    setActiveThreads,
    disposeActiveThreads,
    ...overrides,
  };

  return {
    deps,
    watcherDispose,
    watcherCallbacks,
    showError,
    channel,
    loadFindingsFile,
    controller,
    renderFindings,
    setActiveThreads,
    disposeActiveThreads,
    renderResult,
  };
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

  it('runs the full happy path: discover → resolve → load → setState → render → watcher', async () => {
    const {
      deps,
      channel,
      watcherDispose: _wd,
      renderFindings,
      setActiveThreads,
      renderResult,
      controller,
    } = makeDeps();
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

    expect(renderFindings).toHaveBeenCalledTimes(1);
    const renderArgs = renderFindings.mock.calls[0]?.[0];
    expect(renderArgs?.controller).toBe(controller);
    expect(renderArgs?.workspaceRoot).toBe(WORKSPACE);
    expect(renderArgs?.doc).toBe(state?.doc);
    expect(setActiveThreads).toHaveBeenCalledTimes(1);
    expect(setActiveThreads).toHaveBeenCalledWith(renderResult.fileThreads);

    expect(channel.appendLine).toHaveBeenCalledWith(
      expect.stringContaining('Loaded 2 findings from /tmp/repo/pr-42-auto-review.md'),
    );
    expect(channel.appendLine).toHaveBeenCalledWith('Rendered 2 inline thread(s).');
    const calls = (channel.appendLine as ReturnType<typeof vi.fn>).mock.calls;
    const dumped = calls.some((c) => typeof c[0] === 'string' && c[0].includes('"comment": "comment-one"'));
    expect(dumped).toBe(false);
  });

  it('logs the skipped-PR-level summary when renderFindings reports skipped findings', async () => {
    const { deps, channel, renderFindings } = makeDeps();
    renderFindings.mockReturnValueOnce({
      fileThreads: [makeFakeThread('only')],
      skippedPrLevel: 3,
    });

    await loadFindingsHandler(deps);

    expect(channel.appendLine).toHaveBeenCalledWith('Rendered 1 inline thread(s).');
    expect(channel.appendLine).toHaveBeenCalledWith(
      'Skipped 3 PR-level finding(s) — inline rendering deferred to a later phase.',
    );
  });

  it('does not log a skipped-PR-level line when skippedPrLevel === 0', async () => {
    const { deps, channel } = makeDeps();

    await loadFindingsHandler(deps);

    const calls = (channel.appendLine as ReturnType<typeof vi.fn>).mock.calls;
    const skippedLogged = calls.some(
      (c) => typeof c[0] === 'string' && c[0].includes('PR-level finding(s)'),
    );
    expect(skippedLogged).toBe(false);
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

  it('on loader ParseError: logs full error, shows toast, clears state, disposes watcher and threads', async () => {
    const parseError = new ParseError('broken header', 0, 'IN_HEADER', 12);
    const { deps, channel, showError, disposeActiveThreads, renderFindings } = makeDeps({
      loadFindingsFile: vi.fn(async () => {
        throw parseError;
      }) as LoadDeps['loadFindingsFile'],
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
    expect(renderFindings).not.toHaveBeenCalled();
    expect(disposeActiveThreads).toHaveBeenCalled();
  });

  it('disposes the previous watcher when invoked twice', async () => {
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();
    const createWatcher = vi
      .fn()
      .mockImplementationOnce(() => ({ dispose: firstDispose }))
      .mockImplementationOnce(() => ({ dispose: secondDispose }));
    const { deps } = makeDeps({
      createFindingsWatcher: createWatcher as LoadDeps['createFindingsWatcher'],
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
      createFindingsWatcher: createWatcher as LoadDeps['createFindingsWatcher'],
      loadFindingsFile: loadFindingsFile as LoadDeps['loadFindingsFile'],
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

    const { deps, watcherCallbacks, channel, renderFindings, setActiveThreads } = makeDeps({
      loadFindingsFile: loadFindingsFile as LoadDeps['loadFindingsFile'],
    });

    await loadFindingsHandler(deps);
    expect(getState()?.mtime).toBe(100);
    expect(getState()?.doc).toBe(docA);
    const channelAppend = channel.appendLine as ReturnType<typeof vi.fn>;
    channelAppend.mockClear();
    renderFindings.mockClear();
    setActiveThreads.mockClear();
    (deps.discoverPrNumber as ReturnType<typeof vi.fn>).mockClear();
    (deps.resolveFindingsPath as ReturnType<typeof vi.fn>).mockClear();

    await watcherCallbacks.onReload();

    expect(deps.discoverPrNumber).not.toHaveBeenCalled();
    expect(deps.resolveFindingsPath).not.toHaveBeenCalled();
    expect(loadFindingsFile).toHaveBeenCalledTimes(2);
    expect(getState()?.mtime).toBe(200);
    expect(getState()?.doc).toBe(docB);
    expect(renderFindings).toHaveBeenCalledTimes(1);
    expect(renderFindings.mock.calls[0]?.[0].doc).toBe(docB);
    expect(setActiveThreads).toHaveBeenCalledTimes(1);
    expect(channelAppend).toHaveBeenCalledWith(
      expect.stringContaining('Loaded 2 findings from /tmp/repo/pr-42-auto-review.md'),
    );
  });

  it('watcher onReload surfaces loader errors via toast + channel and clears state and threads', async () => {
    const loadFindingsFile = vi
      .fn()
      .mockResolvedValueOnce({ doc: makeDoc(), mtime: 1 })
      .mockRejectedValueOnce(new ParseError('bad header', 0, 'IN_HEADER', 1));

    const { deps, watcherCallbacks, channel, showError, disposeActiveThreads } = makeDeps({
      loadFindingsFile: loadFindingsFile as LoadDeps['loadFindingsFile'],
    });

    await loadFindingsHandler(deps);
    expect(getState()).not.toBeNull();
    showError.mockClear();
    disposeActiveThreads.mockClear();
    (channel.appendLine as ReturnType<typeof vi.fn>).mockClear();

    await watcherCallbacks.onReload();

    expect(showError).toHaveBeenCalledWith(
      'Failed to load findings — see Review Plugin output.',
    );
    expect(channel.appendLine).toHaveBeenCalledWith(expect.stringContaining('IN_HEADER'));
    expect(getState()).toBeNull();
    expect(disposeActiveThreads).toHaveBeenCalled();
  });

  it('watcher onDelete clears state, disposes watcher, disposes threads, logs to channel', async () => {
    const { deps, watcherCallbacks, watcherDispose, channel, disposeActiveThreads } = makeDeps();

    await loadFindingsHandler(deps);
    expect(getState()).not.toBeNull();
    disposeActiveThreads.mockClear();

    watcherCallbacks.onDelete();

    expect(getState()).toBeNull();
    expect(watcherDispose).toHaveBeenCalledTimes(1);
    expect(disposeActiveThreads).toHaveBeenCalledTimes(1);
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
    const context = { subscriptions } as Partial<vscode.ExtensionContext> as vscode.ExtensionContext;
    const commandDispose = vi.fn();
    (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mockReturnValue({
      dispose: commandDispose,
    });
    setWorkspaceFolders([{ uri: { fsPath: WORKSPACE }, name: 'repo', index: 0 }]);

    const extras: LoadExtras = { controller: makeFakeController() };
    registerLoadFindingsCommand(context, extras);

    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      'reviewPlugin.loadFindings',
      expect.any(Function),
    );
    expect(subscriptions.length).toBeGreaterThanOrEqual(2);
  });

  it('shows an error toast and aborts when no workspace folder is open', async () => {
    const subscriptions: vscode.Disposable[] = [];
    const context = { subscriptions } as Partial<vscode.ExtensionContext> as vscode.ExtensionContext;
    let captured: (() => Promise<void>) | null = null;
    (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mockImplementation(
      (_id: string, cb: () => Promise<void>) => {
        captured = cb;
        return { dispose: vi.fn() };
      },
    );
    setWorkspaceFolders(undefined);

    const extras: LoadExtras = { controller: makeFakeController() };
    registerLoadFindingsCommand(context, extras);
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
      createFindingsWatcher: vi.fn(() => ({ dispose })) as LoadDeps['createFindingsWatcher'],
    });
    await loadFindingsHandler(deps);

    disposeActiveWatcher();
    disposeActiveWatcher();

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
