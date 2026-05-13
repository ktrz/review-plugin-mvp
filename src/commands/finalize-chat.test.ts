import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  createFinalizeChatHandler,
  type FinalizeChatDeps,
} from './finalize-chat';
import {
  HandoverDocumentSchema,
  type ChatMessage,
  type FindingItem,
  type HandoverDocument,
} from '../schema';
import type { FindingsWriter } from '../runtime/findings-writer';
import type { LoadedFindings } from '../runtime/findings-state';

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
    contextValue: 'review-finding-deferred-chatting',
    canReply: true,
    collapsibleState: vscode.CommentThreadCollapsibleState.Expanded,
    state: vscode.CommentThreadState.Unresolved,
    comments: [
      {
        body: 'finding body',
        mode: vscode.CommentMode.Preview,
        author: { name: 'auto-review' },
      } as vscode.Comment,
    ],
  };
  return fake as vscode.CommentThread;
};

function makeHarness(opts: {
  initialItem?: FindingItem;
  initialState?: LoadedFindings | null;
  findId?: string | null;
  inputBoxImpl?: (
    options: vscode.InputBoxOptions,
  ) => Thenable<string | undefined> | Promise<string | undefined>;
  writeImpl?: (filePath: string, data: string) => Promise<{ mtime: number; sha: string }>;
} = {}) {
  const item = opts.initialItem ?? makeItem();
  const stateRef: { current: LoadedFindings | null } = {
    current:
      opts.initialState === undefined ? makeState(item) : opts.initialState,
  };
  const writer = {
    write: vi.fn(
      opts.writeImpl ??
        (async () => ({ mtime: 200, sha: 'sha-final' })),
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
  const showInputBox = vi.fn(
    opts.inputBoxImpl ?? (async () => 'edited resolution'),
  );
  const showInformationMessage = vi.fn<[string], Promise<string | undefined>>(
    async () => undefined,
  );
  const showErrorMessage = vi.fn<[string], Promise<string | undefined>>(
    async () => undefined,
  );
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const runExclusive = async <T>(_path: string, fn: () => Promise<T>): Promise<T> =>
    fn();

  const deps: FinalizeChatDeps = {
    getState: () => stateRef.current,
    setState,
    writer: writer as Partial<FindingsWriter> as FindingsWriter,
    runExclusive,
    findIdByThread,
    refreshThread,
    renderChat,
    getAuthorLabel: () => 'Chris',
    window: {
      showInputBox,
      showInformationMessage,
      showErrorMessage,
    },
    log,
  };

  return {
    deps,
    writer,
    setState,
    refreshThread,
    renderChat,
    showInputBox,
    showInformationMessage,
    showErrorMessage,
    log,
    stateRef,
    findIdByThread,
  };
}

describe('createFinalizeChatHandler', () => {
  it('happy path: deferred + chat ending in assistant → InputBox seed = last assistant, status flips to custom', async () => {
    const chat: ChatMessage[] = [
      { role: 'user', content: 'why' },
      { role: 'assistant', content: 'because of X' },
    ];
    const item = makeItem({ chat });
    const h = makeHarness({ initialItem: item });
    const handler = createFinalizeChatHandler(h.deps);
    const thread = makeThread();

    await handler(thread);

    expect(h.showInputBox).toHaveBeenCalledTimes(1);
    const opts = h.showInputBox.mock.calls[0]?.[0];
    expect(opts?.value).toBe('because of X');
    expect(typeof opts?.validateInput).toBe('function');

    expect(h.writer.write).toHaveBeenCalledTimes(1);
    expect(h.setState).toHaveBeenCalledTimes(1);

    const finalState = h.stateRef.current;
    const finalItem = finalState!.doc.items[0];
    expect(finalItem.status).toBe('custom');
    expect(finalItem.resolution).toBe('edited resolution');
    expect(finalItem.chat).toEqual(chat);

    expect(h.refreshThread).toHaveBeenCalledTimes(1);
    expect(h.renderChat).toHaveBeenCalledTimes(1);
  });

  it('user cancels InputBox → no mutation, no write', async () => {
    const chat: ChatMessage[] = [
      { role: 'user', content: 'why' },
      { role: 'assistant', content: 'because' },
    ];
    const item = makeItem({ chat });
    const h = makeHarness({
      initialItem: item,
      inputBoxImpl: async () => undefined,
    });
    const handler = createFinalizeChatHandler(h.deps);
    const thread = makeThread();

    await handler(thread);

    expect(h.writer.write).not.toHaveBeenCalled();
    expect(h.setState).not.toHaveBeenCalled();
    expect(h.refreshThread).not.toHaveBeenCalled();
  });

  it('no chat → info message, no InputBox, no mutation', async () => {
    const item = makeItem({ chat: undefined });
    const h = makeHarness({ initialItem: item });
    const handler = createFinalizeChatHandler(h.deps);
    const thread = makeThread();

    await handler(thread);

    expect(h.showInputBox).not.toHaveBeenCalled();
    expect(h.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(h.writer.write).not.toHaveBeenCalled();
  });

  it('chat exists but last entry is user (agent has not replied) → info message, no mutation', async () => {
    const chat: ChatMessage[] = [{ role: 'user', content: 'why' }];
    const item = makeItem({ chat });
    const h = makeHarness({ initialItem: item });
    const handler = createFinalizeChatHandler(h.deps);
    const thread = makeThread();

    await handler(thread);

    expect(h.showInputBox).not.toHaveBeenCalled();
    expect(h.showInformationMessage).toHaveBeenCalledTimes(1);
    const msg = h.showInformationMessage.mock.calls[0]?.[0];
    expect(String(msg)).toMatch(/wait for the agent/i);
    expect(h.writer.write).not.toHaveBeenCalled();
  });

  it('non-deferred status → info message, no mutation', async () => {
    const item = makeItem({
      status: 'resolved',
      resolution: 'done',
      chat: [
        { role: 'user', content: 'why' },
        { role: 'assistant', content: 'because' },
      ],
    });
    const h = makeHarness({ initialItem: item });
    const handler = createFinalizeChatHandler(h.deps);
    const thread = makeThread();

    await handler(thread);

    expect(h.showInputBox).not.toHaveBeenCalled();
    expect(h.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(h.writer.write).not.toHaveBeenCalled();
  });

  it('InputBox validateInput rejects empty/whitespace', async () => {
    const chat: ChatMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ];
    const item = makeItem({ chat });
    let capturedValidator:
      | ((s: string) => string | null | undefined | Thenable<string | null | undefined>)
      | undefined;
    const inputBoxImpl: (
      o: vscode.InputBoxOptions,
    ) => Promise<string | undefined> = async (o) => {
      capturedValidator = o.validateInput as typeof capturedValidator;
      return 'ok edited';
    };
    const h = makeHarness({ initialItem: item, inputBoxImpl });
    const handler = createFinalizeChatHandler(h.deps);
    const thread = makeThread();

    await handler(thread);

    expect(capturedValidator).toBeTypeOf('function');
    expect(await capturedValidator!('')).toMatch(/cannot be empty/i);
    expect(await capturedValidator!('   ')).toMatch(/cannot be empty/i);
    expect(await capturedValidator!('non-empty')).toBeNull();
  });

  it('thread with no findingId → log.error, no InputBox, no mutation', async () => {
    const h = makeHarness({ findId: null });
    const handler = createFinalizeChatHandler(h.deps);
    const thread = makeThread();

    await handler(thread);

    expect(h.showInputBox).not.toHaveBeenCalled();
    expect(h.writer.write).not.toHaveBeenCalled();
    expect(h.log.error).toHaveBeenCalledTimes(1);
  });

  it('no findings state loaded → log.error, no InputBox', async () => {
    const h = makeHarness({ initialState: null });
    const handler = createFinalizeChatHandler(h.deps);
    const thread = makeThread();

    await handler(thread);

    expect(h.showInputBox).not.toHaveBeenCalled();
    expect(h.writer.write).not.toHaveBeenCalled();
    expect(h.log.error).toHaveBeenCalled();
  });

  it('writer rejection → error toast, log.error, state unchanged', async () => {
    const chat: ChatMessage[] = [
      { role: 'user', content: 'why' },
      { role: 'assistant', content: 'because' },
    ];
    const item = makeItem({ chat });
    const h = makeHarness({
      initialItem: item,
      writeImpl: async () => {
        throw new Error('disk full');
      },
    });
    const handler = createFinalizeChatHandler(h.deps);
    const thread = makeThread();

    await handler(thread);

    expect(h.writer.write).toHaveBeenCalledTimes(1);
    expect(h.setState).not.toHaveBeenCalled();
    expect(h.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(h.log.error).toHaveBeenCalled();
  });
});
