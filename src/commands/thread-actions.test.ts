import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  handleThreadDecision,
  registerThreadCommands,
  THREAD_COMMAND_IDS,
  type RegisterThreadCommandsDeps,
  type ThreadActionLog,
  type ThreadActionState,
} from './thread-actions';
import * as applyDecisionModule from '../comments/apply-decision';
import { HandoverDocumentSchema, type FindingItem, type HandoverDocument } from '../schema';
import type { FindingsWriter } from '../runtime/findings-writer';

const FILE_PATH = '/tmp/repo/pr-1-auto-review.md';

const makeItem = (
  id: string,
  overrides: Partial<FindingItem> = {},
): FindingItem => {
  const base = {
    id,
    status: 'unresolved' as const,
    source: { kind: 'auto-review' as const, severity: 'critical' as const },
    location: { kind: 'file' as const, file: 'src/foo.ts', line: 1 },
    reportedBy: ['auto-review'],
    comment: 'comment',
    analysis: 'analysis',
    recommendation: 'recommendation',
    options: [],
    resolution: '',
    dirty: false as const,
    rawSource: `raw-${id}`,
  } satisfies Partial<FindingItem>;
  return { ...base, ...overrides } as FindingItem;
};

const makeDoc = (items: FindingItem[] = [makeItem('id-1')]): HandoverDocument =>
  HandoverDocumentSchema.parse({
    header: {
      prUrl: 'https://github.com/example/repo/pull/1',
      prNumber: 1,
      branch: {
        head: { ref: 'feature' },
        base: { ref: 'main' },
      },
      generatedAt: '2026-05-13T00:00:00.000Z',
      status: 'pending',
    },
    items,
  });

const makeState = (
  overrides: Partial<ThreadActionState> = {},
): ThreadActionState => ({
  doc: makeDoc(),
  mtime: 100,
  filePath: FILE_PATH,
  prNumber: 1,
  ...overrides,
});

const makeThread = (label = 'thread-label'): vscode.CommentThread => {
  const fake: Partial<vscode.CommentThread> = {
    label,
    contextValue: 'review-finding-unresolved',
    canReply: false,
    collapsibleState: vscode.CommentThreadCollapsibleState.Expanded,
    state: vscode.CommentThreadState.Unresolved,
    comments: [],
    dispose: vi.fn(),
  };
  return fake as vscode.CommentThread;
};

const makeLog = (): ThreadActionLog & {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

// Loose mock typing — vitest's invariant Mock generics fight harder with
// concrete arg types than they help here. The harness only needs the .mock
// inspection surface and is consumed by tests, not by production code.

function makeDeps(overrides: {
  initialState?: ThreadActionState | null;
  writeImpl?: FindingsWriter['write'];
  findIdImpl?: (thread: vscode.CommentThread) => string | undefined;
  runExclusiveImpl?: <T>(filePath: string, fn: () => Promise<T>) => Promise<T>;
} = {}) {
  const stateRef: { current: ThreadActionState | null } =
    overrides.initialState === undefined
      ? { current: makeState() }
      : { current: overrides.initialState };
  const writer = {
    write: vi.fn(
      overrides.writeImpl ??
        (async () => ({ mtime: 200, sha: 'sha12345' })),
    ),
    getLastWriteSha: vi.fn(() => undefined),
  };
  const getState = vi.fn(() => stateRef.current);
  const setState = vi.fn((next: ThreadActionState) => {
    stateRef.current = next;
  });
  const findIdByThread = vi.fn(
    overrides.findIdImpl ?? ((_t: vscode.CommentThread) => 'id-1'),
  );
  const refreshThread = vi.fn();
  const runExclusiveImpl =
    overrides.runExclusiveImpl ??
    (async <T>(_path: string, fn: () => Promise<T>): Promise<T> => fn());
  const showError = vi.fn();
  const log = makeLog();

  const deps: RegisterThreadCommandsDeps = {
    writer: writer as Partial<FindingsWriter> as FindingsWriter,
    getState,
    setState,
    findIdByThread,
    refreshThread,
    runExclusive: runExclusiveImpl,
    log,
    showError,
  };

  return {
    deps,
    writer,
    getState,
    setState,
    findIdByThread,
    refreshThread,
    runExclusive: runExclusiveImpl,
    showError,
    log,
    stateRef,
  };
}

describe('registerThreadCommands', () => {
  beforeEach(() => {
    (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mockReset();
  });

  it('registers all four thread command IDs', () => {
    const subscriptions: vscode.Disposable[] = [];
    const context = {
      subscriptions,
    } as Partial<vscode.ExtensionContext> as vscode.ExtensionContext;
    const dispose = vi.fn();
    (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mockReturnValue({
      dispose,
    });

    const { deps } = makeDeps();
    registerThreadCommands(context, deps);

    const ids = (
      vscode.commands.registerCommand as ReturnType<typeof vi.fn>
    ).mock.calls.map((c) => c[0]);
    expect(ids).toEqual([
      THREAD_COMMAND_IDS.post,
      THREAD_COMMAND_IDS.dismiss,
      THREAD_COMMAND_IDS.discuss,
      THREAD_COMMAND_IDS.unresolve,
    ]);
    expect(subscriptions.length).toBe(4);
  });

  it('composite dispose() disposes all four registrations', () => {
    const subscriptions: vscode.Disposable[] = [];
    const context = {
      subscriptions,
    } as Partial<vscode.ExtensionContext> as vscode.ExtensionContext;
    const disposes: ReturnType<typeof vi.fn>[] = [];
    (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        const d = vi.fn();
        disposes.push(d);
        return { dispose: d };
      },
    );

    const { deps } = makeDeps();
    const composite = registerThreadCommands(context, deps);
    composite.dispose();

    expect(disposes.length).toBe(4);
    for (const d of disposes) {
      expect(d).toHaveBeenCalledTimes(1);
    }
  });
});

describe('handleThreadDecision', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('post → applyDecision called with "post"; writer + setState + refreshThread invoked', async () => {
    const spy = vi.spyOn(applyDecisionModule, 'applyDecision');
    const { deps, writer, setState, refreshThread } = makeDeps();
    const thread = makeThread();

    await handleThreadDecision({ thread, decision: 'post', deps });

    expect(spy).toHaveBeenCalledTimes(1);
    const args = spy.mock.calls[0];
    expect(args?.[1]).toBe('id-1');
    expect(args?.[2]).toBe('post');
    expect(writer.write).toHaveBeenCalledTimes(1);
    expect(writer.write.mock.calls[0]?.[0]).toBe(FILE_PATH);
    expect(setState).toHaveBeenCalledTimes(1);
    const next = setState.mock.calls[0]?.[0];
    expect(next?.mtime).toBe(200);
    expect(next?.lastWriteSha).toBe('sha12345');
    expect(next?.filePath).toBe(FILE_PATH);
    expect(refreshThread).toHaveBeenCalledTimes(1);
    const refreshedItem = refreshThread.mock.calls[0]?.[1] as FindingItem;
    expect(refreshedItem.id).toBe('id-1');
    expect(refreshedItem.status).toBe('resolved');
  });

  it('dismiss → applyDecision called with "dismiss"; status becomes skipped', async () => {
    const { deps, refreshThread } = makeDeps();
    const thread = makeThread();

    await handleThreadDecision({ thread, decision: 'dismiss', deps });

    const refreshedItem = refreshThread.mock.calls[0]?.[1] as FindingItem;
    expect(refreshedItem.status).toBe('skipped');
  });

  it('discuss → status becomes deferred', async () => {
    const { deps, refreshThread } = makeDeps();
    const thread = makeThread();

    await handleThreadDecision({ thread, decision: 'discuss', deps });

    const refreshedItem = refreshThread.mock.calls[0]?.[1] as FindingItem;
    expect(refreshedItem.status).toBe('deferred');
  });

  it('unresolve → status becomes unresolved (from a resolved item)', async () => {
    const resolvedItem = makeItem('id-1', {
      status: 'resolved',
      resolution: 'kept verbatim',
    });
    const { deps, refreshThread } = makeDeps({
      initialState: makeState({ doc: makeDoc([resolvedItem]) }),
    });
    const thread = makeThread();

    await handleThreadDecision({ thread, decision: 'unresolve', deps });

    const refreshedItem = refreshThread.mock.calls[0]?.[1] as FindingItem;
    expect(refreshedItem.status).toBe('unresolved');
    expect(refreshedItem.resolution).toBe('kept verbatim');
  });

  it('writer rejection → showError invoked, state NOT updated, label suffix removed, error logged', async () => {
    const writeImpl: FindingsWriter['write'] = async () => {
      throw new Error('disk full');
    };
    const { deps, setState, refreshThread, showError, log, stateRef } = makeDeps({
      writeImpl,
    });
    const stateBefore = stateRef.current;
    const thread = makeThread('label-X');

    await handleThreadDecision({ thread, decision: 'post', deps });

    expect(setState).not.toHaveBeenCalled();
    expect(refreshThread).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledTimes(1);
    expect(showError.mock.calls[0]?.[0]).toContain('disk full');
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(thread.label).toBe('label-X');
    expect(stateRef.current).toBe(stateBefore);
  });

  it('unknown thread (findIdByThread returns undefined) → warn, no write, label not touched', async () => {
    const { deps, writer, setState, refreshThread, log } = makeDeps({
      findIdImpl: () => undefined,
    });
    const thread = makeThread('untouched');

    await handleThreadDecision({ thread, decision: 'post', deps });

    expect(writer.write).not.toHaveBeenCalled();
    expect(setState).not.toHaveBeenCalled();
    expect(refreshThread).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(thread.label).toBe('untouched');
  });

  it('no state loaded → warn, no work performed', async () => {
    let runExclusiveCalls = 0;
    const runExclusiveSpy = async <T>(
      _path: string,
      fn: () => Promise<T>,
    ): Promise<T> => {
      runExclusiveCalls += 1;
      return fn();
    };
    const { deps, writer, log } = makeDeps({
      initialState: null,
      runExclusiveImpl: runExclusiveSpy,
    });
    const thread = makeThread();

    await handleThreadDecision({ thread, decision: 'post', deps });

    expect(runExclusiveCalls).toBe(0);
    expect(writer.write).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('label suffix appears during RMW; refreshThread label stands after success', async () => {
    const labelsObserved: string[] = [];
    const { deps, refreshThread } = makeDeps({
      writeImpl: async () => {
        labelsObserved.push(String(thread.label));
        return { mtime: 200, sha: 'sha12345' };
      },
    });
    refreshThread.mockImplementation((t: vscode.CommentThread) => {
      t.label = 'refreshed-label';
    });
    const thread = makeThread('hello');

    await handleThreadDecision({ thread, decision: 'post', deps });

    expect(labelsObserved).toEqual(['hello (saving…)']);
    expect(thread.label).toBe('refreshed-label');
  });

  it('label suffix is cleared on failure (finally restores label)', async () => {
    const { deps } = makeDeps({
      writeImpl: async () => {
        throw new Error('boom');
      },
    });
    const thread = makeThread('hello');

    await handleThreadDecision({ thread, decision: 'post', deps });

    expect(thread.label).toBe('hello');
  });

  it('sequential clicks via runExclusive: second handler sees first handler\'s mutation in getState()', async () => {
    const stateRef: { current: ThreadActionState | null } = {
      current: makeState(),
    };
    const writes: number[] = [];
    let writeCounter = 0;
    const writer = {
      write: vi.fn(async () => {
        writeCounter += 1;
        const sha = `sha-${writeCounter}`;
        writes.push(writeCounter);
        return { mtime: 200 + writeCounter, sha };
      }),
      getLastWriteSha: vi.fn(() => undefined),
    };
    const insideLockStates: Array<ThreadActionState | null> = [];
    let insideLockDepth = 0;
    const getState = vi.fn(() => {
      if (insideLockDepth > 0) {
        insideLockStates.push(stateRef.current);
      }
      return stateRef.current;
    });
    const setState = vi.fn((next: ThreadActionState) => {
      stateRef.current = next;
    });
    const chain = new Map<string, Promise<unknown>>();
    const runExclusive = <T>(
      filePath: string,
      fn: () => Promise<T>,
    ): Promise<T> => {
      const previous = chain.get(filePath) ?? Promise.resolve();
      const next = previous.then(
        () => {
          insideLockDepth += 1;
          return fn().finally(() => {
            insideLockDepth -= 1;
          });
        },
        () => {
          insideLockDepth += 1;
          return fn().finally(() => {
            insideLockDepth -= 1;
          });
        },
      );
      chain.set(
        filePath,
        next.then(
          () => undefined,
          () => undefined,
        ),
      );
      return next;
    };
    const findIdByThread = vi.fn(() => 'id-1');
    const refreshThread = vi.fn();
    const showError = vi.fn();

    const deps: RegisterThreadCommandsDeps = {
      writer: writer as Partial<FindingsWriter> as FindingsWriter,
      getState,
      setState,
      findIdByThread,
      refreshThread,
      runExclusive,
      log: makeLog(),
      showError,
    };
    const thread = makeThread();

    const p1 = handleThreadDecision({ thread, decision: 'post', deps });
    const p2 = handleThreadDecision({ thread, decision: 'dismiss', deps });
    await Promise.all([p1, p2]);

    expect(writes).toEqual([1, 2]);
    expect(insideLockStates[0]?.mtime).toBe(100);
    expect(insideLockStates[1]?.mtime).toBe(201);
    expect(stateRef.current?.mtime).toBe(202);
    expect(stateRef.current?.lastWriteSha).toBe('sha-2');
  });
});
