import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { createChatReplyHandler, type ChatReplyDeps } from './chat-reply';
import {
  HandoverDocumentSchema,
  type ChatMessage,
  type FindingItem,
  type HandoverDocument,
} from '../schema';
import type { FindingsWriter } from '../runtime/findings-writer';
import type { LoadedFindings } from '../runtime/findings-state';
import {
  ChatAlreadyInFlightError,
  type ChatSessionStore,
} from '../runtime/chat-session';
import { ClaudeRunnerError } from '../llm/claude-runner';
import { renderChat } from '../comments/chat-renderer';
import {
  setPersonaIcons,
  clearPersonaIcons,
  type PersonaIcons,
} from '../comments/persona-icons';

const FILE_PATH = '/tmp/repo/pr-1-auto-review.md';
const FINDING_ID = 'F-001';

const makeItem = (overrides: Partial<FindingItem> = {}): FindingItem => {
  const base = {
    id: FINDING_ID,
    status: 'deferred' as const,
    source: { kind: 'auto-review' as const, severity: 'critical' as const },
    location: { kind: 'file' as const, file: 'src/foo.ts', line: 5 },
    reportedBy: ['auto-review'],
    comment: 'comment',
    analysis: 'analysis',
    recommendation: 'rec',
    options: [],
    resolution: '',
    dirty: false as const,
    rawSource: 'raw',
  } satisfies Partial<FindingItem>;
  return { ...base, ...overrides } as FindingItem;
};

const makeDoc = (items: FindingItem[]): HandoverDocument =>
  HandoverDocumentSchema.parse({
    header: {
      prUrl: 'https://github.com/example/repo/pull/1',
      prNumber: 1,
      branch: { head: { ref: 'feat' }, base: { ref: 'main' } },
      generatedAt: '2026-05-13T00:00:00.000Z',
      status: 'pending',
    },
    items,
  });

const makeState = (item: FindingItem): LoadedFindings => ({
  doc: makeDoc([item]),
  mtime: 100,
  filePath: FILE_PATH,
  prNumber: 1,
  lastWriteSha: 'sha-init',
});

const makeThread = (): vscode.CommentThread => {
  const fake: Partial<vscode.CommentThread> = {
    label: '[deferred] critical · auto-review',
    contextValue: 'review-finding-deferred',
    canReply: true,
    collapsibleState: vscode.CommentThreadCollapsibleState.Expanded,
    state: vscode.CommentThreadState.Unresolved,
    comments: [
      {
        body: 'finding body',
        mode: vscode.CommentMode.Preview,
        author: { name: 'auto-review' },
        contextValue: 'review-finding-comment',
      } as vscode.Comment,
    ],
  };
  return fake as vscode.CommentThread;
};

function makeHarness(opts: {
  initialItem?: FindingItem;
  initialState?: LoadedFindings | null;
  findId?: string | null;
  runImpl?: (prompt: string, signal: AbortSignal) => Promise<string>;
  writeImpl?: (filePath: string, data: string) => Promise<{ mtime: number; sha: string }>;
} = {}) {
  const item = opts.initialItem ?? makeItem();
  const stateRef: { current: LoadedFindings | null } = {
    current:
      opts.initialState === undefined ? makeState(item) : opts.initialState,
  };
  let writeCounter = 0;
  const writer = {
    write: vi.fn(
      opts.writeImpl ??
        (async () => {
          writeCounter += 1;
          return { mtime: 100 + writeCounter, sha: `sha-${writeCounter}` };
        }),
    ),
    getLastWriteSha: vi.fn(() => undefined),
  };
  const setState = vi.fn((next: LoadedFindings) => {
    stateRef.current = next;
  });
  const findIdByThread = vi.fn(
    () => (opts.findId === null ? undefined : (opts.findId ?? FINDING_ID)),
  );
  const refreshThread = vi.fn();
  const renderChat = vi.fn();
  const runnerRun = vi.fn(
    opts.runImpl ?? (async () => 'agent reply'),
  );
  const runner = { run: runnerRun };
  const promptBuilder = { build: vi.fn(() => 'PROMPT') };
  const hunkLoader = {
    load: vi.fn(async () => ({
      hunk: 'hunk',
      startLine: 1,
      lang: 'typescript',
    })),
  };
  const externalAbort = new AbortController();
  const startSpy = vi.fn(() => externalAbort.signal);
  const completeSpy = vi.fn();
  const abortSpy = vi.fn();
  const setPlaceholder = vi.fn();
  const getPlaceholder = vi.fn();
  const isInFlight = vi.fn(() => false);
  const sessions: ChatSessionStore = {
    start: startSpy,
    complete: completeSpy,
    abort: abortSpy,
    isInFlight,
    setPlaceholder,
    getPlaceholder,
  };
  const runExclusive = async <T>(_path: string, fn: () => Promise<T>): Promise<T> =>
    fn();
  const showErrorMessage = vi.fn<[string], Promise<string | undefined>>(
    async () => undefined,
  );
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const window = {
    showErrorMessage,
    showInformationMessage: vi.fn(async () => undefined),
  };

  const deps: ChatReplyDeps = {
    getState: () => stateRef.current,
    setState,
    writer: writer as Partial<FindingsWriter> as FindingsWriter,
    runExclusive,
    runner,
    promptBuilder,
    hunkLoader,
    sessions,
    renderChat,
    refreshThread,
    findIdByThread,
    getAuthorLabel: () => 'Chris',
    log,
    window,
  };

  return {
    deps,
    writer,
    setState,
    refreshThread,
    renderChat,
    runnerRun,
    showErrorMessage,
    log,
    sessions,
    stateRef,
    findIdByThread,
    abortSpy,
    startSpy,
    completeSpy,
    inFlightSignal: externalAbort.signal,
    externalAbort,
  };
}

describe('createChatReplyHandler', () => {
  it('happy path: user reply + agent reply → 2 writes, contextValue ends as deferred-chatting', async () => {
    const h = makeHarness();
    const handler = createChatReplyHandler(h.deps);
    const thread = makeThread();

    await handler({ thread, text: 'why?' });

    expect(h.writer.write).toHaveBeenCalledTimes(2);
    expect(h.setState).toHaveBeenCalledTimes(2);

    const finalState = h.stateRef.current;
    expect(finalState).not.toBeNull();
    const finalItem = finalState!.doc.items[0];
    expect(finalItem.chat).toEqual([
      { role: 'user', content: 'why?' },
      { role: 'assistant', content: 'agent reply' },
    ] satisfies ChatMessage[]);

    expect(h.refreshThread).toHaveBeenCalled();
    const lastRefreshArg = h.refreshThread.mock.calls.at(-1)?.[1] as FindingItem;
    expect(lastRefreshArg.status).toBe('deferred');
    expect(lastRefreshArg.chat?.length).toBe(2);

    expect(h.renderChat).toHaveBeenCalled();
    expect(h.startSpy).toHaveBeenCalledTimes(1);
    expect(h.completeSpy).toHaveBeenCalledTimes(1);
  });

  it('thinking placeholder carries the agent persona avatar', async () => {
    const icons: PersonaIcons = {
      autoReview: vscode.Uri.file('/ext/media/avatar-auto-review.svg'),
      reviewer: vscode.Uri.file('/ext/media/avatar-reviewer.svg'),
      user: vscode.Uri.file('/ext/media/avatar-user.svg'),
      agent: vscode.Uri.file('/ext/media/avatar-agent.svg'),
    };
    setPersonaIcons(icons);
    try {
      const thread = makeThread();
      let placeholderIcon: unknown = 'unset';
      const runImpl = async () => {
        placeholderIcon = thread.comments.at(-1)?.author.iconPath;
        return 'agent reply';
      };
      const h = makeHarness({ runImpl });
      const handler = createChatReplyHandler(h.deps);

      await handler({ thread, text: 'why?' });

      expect(placeholderIcon).toBe(icons.agent);
    } finally {
      clearPersonaIcons();
    }
  });

  it('reply on non-deferred status auto-promotes status to deferred before appending chat', async () => {
    const initial = makeItem({ status: 'unresolved' });
    const h = makeHarness({ initialItem: initial });
    const handler = createChatReplyHandler(h.deps);
    const thread = makeThread();

    await handler({ thread, text: 'wait, reopen this' });

    const stateAfterUserWrite = h.setState.mock.calls[0]?.[0] as LoadedFindings;
    const itemAfterUser = stateAfterUserWrite.doc.items[0];
    expect(itemAfterUser.status).toBe('deferred');
    expect(itemAfterUser.chat).toEqual([
      { role: 'user', content: 'wait, reopen this' },
    ] satisfies ChatMessage[]);

    const earlyRefreshArg = h.refreshThread.mock.calls[0]?.[1] as FindingItem;
    expect(earlyRefreshArg.status).toBe('deferred');
  });

  it('reply on already-deferred status keeps status (no spurious mutation)', async () => {
    const h = makeHarness();
    const handler = createChatReplyHandler(h.deps);
    const thread = makeThread();

    await handler({ thread, text: 'continuing' });

    const stateAfterUserWrite = h.setState.mock.calls[0]?.[0] as LoadedFindings;
    expect(stateAfterUserWrite.doc.items[0].status).toBe('deferred');
  });

  it('reply on resolved status re-opens to deferred (terminal → deferred)', async () => {
    const initial = makeItem({ status: 'resolved', resolution: 'done' });
    const h = makeHarness({ initialItem: initial });
    const handler = createChatReplyHandler(h.deps);
    const thread = makeThread();

    await handler({ thread, text: 'actually, hold on' });

    const stateAfterUserWrite = h.setState.mock.calls[0]?.[0] as LoadedFindings;
    expect(stateAfterUserWrite.doc.items[0].status).toBe('deferred');
  });

  it('CLI ENOENT → 1 write (user only), placeholder replaced with error marker, toast called', async () => {
    const runImpl = async () => {
      throw new ClaudeRunnerError('not found', 'enoent', '', null);
    };
    const h = makeHarness({ runImpl });
    const handler = createChatReplyHandler(h.deps);
    const thread = makeThread();

    await handler({ thread, text: 'why?' });

    expect(h.writer.write).toHaveBeenCalledTimes(1);
    expect(h.setState).toHaveBeenCalledTimes(1);
    expect(h.showErrorMessage).toHaveBeenCalledTimes(1);
    const toast = h.showErrorMessage.mock.calls[0]?.[0];
    expect(String(toast)).toMatch(/claude CLI not found/i);

    const finalState = h.stateRef.current;
    const finalItem = finalState!.doc.items[0];
    expect(finalItem.chat).toEqual([{ role: 'user', content: 'why?' }]);

    expect(h.completeSpy).toHaveBeenCalledTimes(1);
    expect(h.log.error).toHaveBeenCalled();
  });

  it('CLI non-zero exit → 1 write, toast with stderr tail', async () => {
    const runImpl = async () => {
      throw new ClaudeRunnerError(
        'exit 1',
        'exit',
        'something went wrong on disk',
        1,
      );
    };
    const h = makeHarness({ runImpl });
    const handler = createChatReplyHandler(h.deps);
    const thread = makeThread();

    await handler({ thread, text: 'why?' });

    expect(h.writer.write).toHaveBeenCalledTimes(1);
    expect(h.showErrorMessage).toHaveBeenCalledTimes(1);
    const toast = h.showErrorMessage.mock.calls[0]?.[0];
    expect(String(toast)).toMatch(/claude CLI failed/i);
    expect(h.log.error).toHaveBeenCalled();
  });

  it('CLI auth failure → distinct toast', async () => {
    const runImpl = async () => {
      throw new ClaudeRunnerError('auth', 'auth', 'not logged in', 1);
    };
    const h = makeHarness({ runImpl });
    const handler = createChatReplyHandler(h.deps);
    const thread = makeThread();

    await handler({ thread, text: 'why?' });

    const toast = h.showErrorMessage.mock.calls[0]?.[0];
    expect(String(toast)).toMatch(/not authenticated/i);
  });

  it('CLI aborted mid-call → no assistant write, no toast for aborted', async () => {
    const runImpl = async () => {
      throw new ClaudeRunnerError('aborted', 'aborted', '', null);
    };
    const h = makeHarness({ runImpl });
    const handler = createChatReplyHandler(h.deps);
    const thread = makeThread();

    await handler({ thread, text: 'why?' });

    expect(h.writer.write).toHaveBeenCalledTimes(1);
    expect(h.showErrorMessage).not.toHaveBeenCalled();
    const finalState = h.stateRef.current;
    const finalItem = finalState!.doc.items[0];
    expect(finalItem.chat).toEqual([{ role: 'user', content: 'why?' }]);
  });

  it('thread with no findingId → log.error, no writes', async () => {
    const h = makeHarness({ findId: null });
    const handler = createChatReplyHandler(h.deps);
    const thread = makeThread();

    await handler({ thread, text: 'why?' });

    expect(h.writer.write).not.toHaveBeenCalled();
    expect(h.setState).not.toHaveBeenCalled();
    expect(h.log.error).toHaveBeenCalledTimes(1);
    expect(h.runnerRun).not.toHaveBeenCalled();
  });

  it('no findings state loaded → log.error, no writes, no CLI call', async () => {
    const h = makeHarness({ initialState: null });
    const handler = createChatReplyHandler(h.deps);
    const thread = makeThread();

    await handler({ thread, text: 'why?' });

    expect(h.writer.write).not.toHaveBeenCalled();
    expect(h.runnerRun).not.toHaveBeenCalled();
    expect(h.log.error).toHaveBeenCalled();
  });

  it('start throws ChatAlreadyInFlightError → log.warn, only user write done', async () => {
    const h = makeHarness();
    h.startSpy.mockImplementation(() => {
      throw new ChatAlreadyInFlightError(FINDING_ID);
    });
    const handler = createChatReplyHandler(h.deps);
    const thread = makeThread();

    await handler({ thread, text: 'why?' });

    expect(h.writer.write).toHaveBeenCalledTimes(1);
    expect(h.runnerRun).not.toHaveBeenCalled();
    expect(h.log.warn).toHaveBeenCalled();
  });

  it('passes existing chat transcript to promptBuilder (excludes the new user message from prior transcript)', async () => {
    const seeded = makeItem({
      chat: [
        { role: 'user', content: 'earlier' },
        { role: 'assistant', content: 'earlier-reply' },
      ],
    });
    const h = makeHarness({ initialItem: seeded });
    const promptBuilder = h.deps.promptBuilder as { build: ReturnType<typeof vi.fn> };
    const handler = createChatReplyHandler(h.deps);
    const thread = makeThread();

    await handler({ thread, text: 'follow-up' });

    expect(promptBuilder.build).toHaveBeenCalledTimes(1);
    const arg = promptBuilder.build.mock.calls[0]?.[0];
    expect(arg?.transcript).toEqual([
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'earlier-reply' },
    ]);
    expect(arg?.userMessage).toBe('follow-up');
  });

  it('updates thread.contextValue to deferred-chatting via refreshThread after assistant reply', async () => {
    const h = makeHarness();
    const handler = createChatReplyHandler(h.deps);
    const thread = makeThread();

    await handler({ thread, text: 'why?' });

    const refreshCalls = h.refreshThread.mock.calls;
    expect(refreshCalls.length).toBeGreaterThanOrEqual(1);
    const lastItem = refreshCalls.at(-1)?.[1] as FindingItem;
    expect(lastItem.chat?.length).toBe(2);
    expect(lastItem.status).toBe('deferred');
  });

  it('renderChat is called after refreshThread so chat comments survive in thread.comments', async () => {
    // Use the real renderChat and a real-ish refreshThread (resets to [findingComment])
    // to verify the order. With the buggy order (renderChat first, refreshThread second)
    // thread.comments ends up with length 1; with the fix (refreshThread first) it ends
    // with length 3 (findingComment + user + assistant).
    const baseItem = makeItem();
    const stateRef: { current: LoadedFindings | null } = {
      current: makeState(baseItem),
    };
    let writeCounter = 0;
    const writer = {
      write: vi.fn(async () => {
        writeCounter += 1;
        return { mtime: 100 + writeCounter, sha: `sha-${writeCounter}` };
      }),
      getLastWriteSha: vi.fn(() => undefined),
    };
    const setState = vi.fn((next: LoadedFindings) => {
      stateRef.current = next;
    });

    // Real-ish refreshThread: resets thread.comments to [thread.comments[0]] (simulates render-session)
    const refreshThread = vi.fn((thread: vscode.CommentThread, _item: FindingItem) => {
      const first = thread.comments[0];
      thread.comments = first !== undefined ? [first] : [];
    });

    const thread = makeThread();
    const externalAbort = new AbortController();
    const sessions: ChatSessionStore = {
      start: vi.fn(() => externalAbort.signal),
      complete: vi.fn(),
      abort: vi.fn(),
      isInFlight: vi.fn(() => false),
      setPlaceholder: vi.fn(),
      getPlaceholder: vi.fn(),
    };

    const deps: ChatReplyDeps = {
      getState: () => stateRef.current,
      setState,
      writer: writer as Partial<FindingsWriter> as FindingsWriter,
      runExclusive: async (_path, fn) => fn(),
      runner: { run: vi.fn(async () => 'agent reply') },
      promptBuilder: { build: vi.fn(() => 'PROMPT') },
      hunkLoader: { load: vi.fn(async () => ({ hunk: 'h', startLine: 1, lang: 'typescript' })) },
      sessions,
      renderChat,
      refreshThread,
      findIdByThread: vi.fn(() => FINDING_ID),
      getAuthorLabel: () => 'Chris',
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      window: {
        showErrorMessage: vi.fn(async () => undefined),
        showInformationMessage: vi.fn(async () => undefined),
      },
    };

    const handler = createChatReplyHandler(deps);
    await handler({ thread, text: 'why?' });

    // After a successful turn: findingComment (index 0) + user comment + assistant comment = 3
    expect(thread.comments).toHaveLength(3);
  });
});
