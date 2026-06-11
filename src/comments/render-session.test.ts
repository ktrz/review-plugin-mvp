import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  disposeAll,
  findIdByThread,
  findThreadById,
  getActiveThreads,
  reconcileEntries,
  refreshThread,
  setActiveEntries,
  upgradeReviewerAvatars,
} from './render-session';
import { clearAvatarCache, githubAvatarUri } from './avatar-cache';
import type { ThreadEntry } from './thread-builder';
import type { FindingItem } from '../schema';
import {
  __resetOutputChannelForTests,
  setOutputChannel,
} from '../runtime/findings-state';

const makeThread = (label = 'thread'): vscode.CommentThread => {
  const fake: Partial<vscode.CommentThread> = {
    label,
    contextValue: '',
    canReply: false,
    collapsibleState: vscode.CommentThreadCollapsibleState.Collapsed,
    state: vscode.CommentThreadState.Unresolved,
    comments: [],
    dispose: vi.fn(),
  };
  return fake as vscode.CommentThread;
};

const makeItem = (
  id: string,
  overrides: Partial<FindingItem> = {},
): FindingItem => {
  const base: FindingItem = {
    id,
    dirty: false,
    rawSource: 'raw',
    status: 'unresolved',
    source: { kind: 'auto-review', severity: 'critical' },
    location: { kind: 'file', file: 'src/a.ts', line: 1 },
    reportedBy: ['auto-review'],
    comment: 'c',
    analysis: 'a',
    recommendation: 'r',
    options: [],
    resolution: '',
  };
  return { ...base, ...overrides } satisfies FindingItem;
};

const makeEntry = (
  id: string,
  itemOverrides: Partial<FindingItem> = {},
): ThreadEntry => ({
  thread: makeThread(`thread-${id}`),
  id,
  item: makeItem(id, itemOverrides),
});

describe('render-session', () => {
  beforeEach(() => {
    disposeAll();
  });

  describe('disposeAll', () => {
    it('disposes every active thread and clears the registry', () => {
      const e1 = makeEntry('d1');
      const e2 = makeEntry('d2');
      setActiveEntries([e1, e2]);
      disposeAll();
      expect(e1.thread.dispose).toHaveBeenCalledTimes(1);
      expect(e2.thread.dispose).toHaveBeenCalledTimes(1);
      expect(getActiveThreads()).toEqual([]);
    });

    it('is safe to call when the registry is already empty', () => {
      expect(() => disposeAll()).not.toThrow();
      expect(getActiveThreads()).toEqual([]);
    });

    it('is safe to call twice in a row (double-dispose protection)', () => {
      const e = makeEntry('d3');
      setActiveEntries([e]);
      disposeAll();
      expect(() => disposeAll()).not.toThrow();
      expect(e.thread.dispose).toHaveBeenCalledTimes(1);
      expect(getActiveThreads()).toEqual([]);
    });
  });

  describe('getActiveThreads', () => {
    it('returns the threads from the active entries', () => {
      const e = makeEntry('g1');
      setActiveEntries([e]);
      expect(getActiveThreads()).toEqual([e.thread]);
    });

    it('returns an empty array before any setActiveEntries call', () => {
      expect(getActiveThreads()).toEqual([]);
    });
  });

  describe('dispose error handling', () => {
    const makeChannel = (): vscode.OutputChannel => {
      const fake: Partial<vscode.OutputChannel> = {
        name: 'Review Plugin',
        appendLine: vi.fn(),
        append: vi.fn(),
        clear: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn(),
        replace: vi.fn(),
      };
      return fake as vscode.OutputChannel;
    };

    afterEach(() => {
      __resetOutputChannelForTests();
    });

    it('logs to the output channel when a thread.dispose throws and continues disposing the rest', () => {
      const channel = makeChannel();
      setOutputChannel(channel);
      const throwingDispose = vi.fn(() => {
        throw new Error('boom');
      });
      const okDispose = vi.fn();
      const throwingFake: Partial<vscode.CommentThread> = {
        label: 'bad',
        dispose: throwingDispose,
      };
      const okFake: Partial<vscode.CommentThread> = {
        label: 'good',
        dispose: okDispose,
      };
      const throwing = throwingFake as vscode.CommentThread;
      const ok = okFake as vscode.CommentThread;

      setActiveEntries([
        { thread: throwing, id: 'err-1', item: makeItem('err-1') },
        { thread: ok, id: 'err-2', item: makeItem('err-2') },
      ]);
      disposeAll();

      expect(throwingDispose).toHaveBeenCalledTimes(1);
      expect(okDispose).toHaveBeenCalledTimes(1);
      expect(channel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Failed to dispose comment thread: boom'),
      );
      expect(getActiveThreads()).toEqual([]);
    });

    it('falls back to console.warn when the output channel is not initialized', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const throwingDispose = vi.fn(() => {
          throw new Error('uninit-boom');
        });
        const throwingFake: Partial<vscode.CommentThread> = {
          label: 'bad',
          dispose: throwingDispose,
        };
        const throwing = throwingFake as vscode.CommentThread;

        setActiveEntries([{ thread: throwing, id: 'warn-1', item: makeItem('warn-1') }]);
        disposeAll();

        expect(throwingDispose).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          '[review-plugin] Failed to dispose comment thread:',
          'uninit-boom',
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe('id registry', () => {
    it('registers N entries by id; findThreadById returns the entry; findIdByThread reverses', () => {
      const e1 = makeEntry('id-1');
      const e2 = makeEntry('id-2');
      const e3 = makeEntry('id-3');
      setActiveEntries([e1, e2, e3]);

      expect(findThreadById('id-1')?.thread).toBe(e1.thread);
      expect(findThreadById('id-1')?.item).toBe(e1.item);
      expect(findThreadById('id-2')?.thread).toBe(e2.thread);
      expect(findThreadById('id-3')?.thread).toBe(e3.thread);

      expect(findIdByThread(e1.thread)).toBe('id-1');
      expect(findIdByThread(e2.thread)).toBe('id-2');
      expect(findIdByThread(e3.thread)).toBe('id-3');
    });

    it('findThreadById returns undefined for unknown id', () => {
      const e = makeEntry('id-1');
      setActiveEntries([e]);
      expect(findThreadById('nope')).toBeUndefined();
    });

    it('findIdByThread returns undefined for unregistered thread', () => {
      const stranger = makeThread('stranger');
      expect(findIdByThread(stranger)).toBeUndefined();
    });

    it('disposeAll clears both directions of the registry', () => {
      const e = makeEntry('id-x');
      setActiveEntries([e]);
      expect(findIdByThread(e.thread)).toBe('id-x');
      disposeAll();
      expect(findThreadById('id-x')).toBeUndefined();
      expect(findIdByThread(e.thread)).toBeUndefined();
      expect(e.thread.dispose).toHaveBeenCalledTimes(1);
    });

    it('setActiveEntries disposes previously active entries', () => {
      const e1 = makeEntry('id-1');
      setActiveEntries([e1]);
      const e2 = makeEntry('id-2');
      setActiveEntries([e2]);
      expect(e1.thread.dispose).toHaveBeenCalledTimes(1);
      expect(findThreadById('id-1')).toBeUndefined();
      expect(findThreadById('id-2')?.thread).toBe(e2.thread);
    });
  });

  describe('refreshThread', () => {
    it('updates label, contextValue, state, collapsibleState, canReply in place AND updates registry entry item', () => {
      const e = makeEntry('id-r', { status: 'unresolved' });
      setActiveEntries([e]);

      const updatedItem = makeItem('id-r', {
        status: 'resolved',
        resolution: 'done',
      });
      refreshThread(e.thread, updatedItem);

      expect(e.thread.contextValue).toBe('review-finding-resolved');
      expect(e.thread.state).toBe(vscode.CommentThreadState.Resolved);
      expect(e.thread.collapsibleState).toBe(vscode.CommentThreadCollapsibleState.Collapsed);
      expect(e.thread.canReply).toBe(true);
      expect(e.thread.label).toBe('[resolved] critical · auto-review');
      expect(findThreadById('id-r')?.item).toBe(updatedItem);
    });

    it('keeps the reviewer avatar on the finding comment after refresh', () => {
      const e = makeEntry('id-av', {
        status: 'unresolved',
        source: { kind: 'reviewer', login: 'NachoVazquez', severity: 'suggestion' },
        reportedBy: ['@NachoVazquez'],
      });
      setActiveEntries([e]);

      const updatedItem = makeItem('id-av', {
        status: 'deferred',
        source: { kind: 'reviewer', login: 'NachoVazquez', severity: 'suggestion' },
        reportedBy: ['@NachoVazquez'],
      });
      refreshThread(e.thread, updatedItem);

      const iconPath = e.thread.comments[0].author.iconPath as vscode.Uri;
      expect(iconPath?.toString()).toBe('https://github.com/NachoVazquez.png?size=48');
    });

    it('preserves the severity label on the finding comment after refresh', () => {
      const e = makeEntry('id-label', {
        source: { kind: 'auto-review', severity: 'important' },
      });
      e.thread.comments = [
        {
          body: new vscode.MarkdownString('finding'),
          mode: vscode.CommentMode.Preview,
          author: { name: 'auto-review' },
          label: 'important',
          contextValue: 'review-finding-comment',
        },
      ];
      setActiveEntries([e]);

      const updatedItem = makeItem('id-label', {
        source: { kind: 'auto-review', severity: 'important' },
        status: 'deferred',
      });
      refreshThread(e.thread, updatedItem);

      expect(e.thread.comments[0].label).toBe('important');
    });

    it('keeps canReply true across status transitions (reply auto-promotes status)', () => {
      const e = makeEntry('id-d', { status: 'unresolved' });
      setActiveEntries([e]);

      const updatedItem = makeItem('id-d', { status: 'deferred' });
      refreshThread(e.thread, updatedItem);

      expect(e.thread.canReply).toBe(true);
      expect(e.thread.contextValue).toBe('review-finding-deferred');
    });

    it('paints persisted chat messages after the finding comment', () => {
      const e = makeEntry('id-c', { status: 'deferred' });
      setActiveEntries([e]);

      const updatedItem = makeItem('id-c', {
        status: 'deferred',
        chat: [
          { role: 'user', content: 'q?' },
          { role: 'assistant', content: 'a.' },
        ],
      });
      refreshThread(e.thread, updatedItem);

      expect(e.thread.comments).toHaveLength(3);
      expect(e.thread.comments[1].contextValue).toBe('review-chat-user');
      expect(e.thread.comments[2].contextValue).toBe('review-chat-assistant');
    });

    it('logs a warning when invoked on an unregistered thread (no throw, no registry mutation)', () => {
      const channel: Partial<vscode.OutputChannel> = {
        name: 'Review Plugin',
        appendLine: vi.fn(),
        append: vi.fn(),
        clear: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn(),
        replace: vi.fn(),
      };
      setOutputChannel(channel as vscode.OutputChannel);
      try {
        const stranger = makeThread('stranger');
        expect(() => refreshThread(stranger, makeItem('orphan'))).not.toThrow();
        expect(channel.appendLine).toHaveBeenCalledWith(
          expect.stringContaining('refreshThread called for an unregistered thread'),
        );
      } finally {
        __resetOutputChannelForTests();
      }
    });
  });

  describe('upgradeReviewerAvatars', () => {
    afterEach(() => {
      clearAvatarCache();
      vi.unstubAllGlobals();
    });

    const reviewerEntry = (): ThreadEntry => {
      const thread = makeThread('thread-rev');
      thread.comments = [
        {
          body: new vscode.MarkdownString('finding'),
          mode: vscode.CommentMode.Preview,
          author: { name: '@alice', iconPath: githubAvatarUri('alice') },
          contextValue: 'review-finding-comment',
        },
        {
          body: new vscode.MarkdownString('reply'),
          mode: vscode.CommentMode.Preview,
          author: { name: 'You' },
          contextValue: 'review-chat-user',
        },
      ];
      return {
        thread,
        id: 'rev-1',
        item: makeItem('rev-1', {
          source: { kind: 'reviewer', login: 'alice', severity: 'suggestion' },
          reportedBy: ['@alice'],
        }),
      };
    };

    it('swaps the fetched circular avatar onto the finding comment, preserving chat', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          status: 200,
          arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer.slice(0),
        })),
      );
      const entry = reviewerEntry();
      setActiveEntries([entry]);

      await upgradeReviewerAvatars([entry]);

      const iconPath = entry.thread.comments[0].author.iconPath as vscode.Uri;
      expect(iconPath?.toString().startsWith('data:image/svg+xml;base64,')).toBe(true);
      expect(entry.thread.comments).toHaveLength(2);
      expect(entry.thread.comments[1].contextValue).toBe('review-chat-user');
    });

    it('ignores auto-review entries and leaves the finding comment untouched', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const entry = makeEntry('auto-1', {
        source: { kind: 'auto-review', severity: 'critical' },
      });
      entry.thread.comments = [
        {
          body: new vscode.MarkdownString('finding'),
          mode: vscode.CommentMode.Preview,
          author: { name: 'auto-review' },
          contextValue: 'review-finding-comment',
        },
      ];
      setActiveEntries([entry]);

      await upgradeReviewerAvatars([entry]);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(entry.thread.comments[0].author.iconPath).toBeUndefined();
    });

    it('keeps the square avatar when the fetch fails and logs the warning with the login', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) })),
      );
      const appendLine = vi.fn();
      setOutputChannel({
        name: 'Review Plugin',
        appendLine,
        append: vi.fn(),
        clear: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn(),
        replace: vi.fn(),
      } as unknown as vscode.OutputChannel);
      const entry = reviewerEntry();
      setActiveEntries([entry]);

      try {
        await expect(upgradeReviewerAvatars([entry])).resolves.toBeUndefined();
        expect((entry.thread.comments[0].author.iconPath as vscode.Uri).toString()).toBe(
          githubAvatarUri('alice').toString(),
        );
        expect(appendLine).toHaveBeenCalledWith(expect.stringContaining('@alice'));
      } finally {
        __resetOutputChannelForTests();
      }
    });

    it('emits a summary warning when all reviewer fetches fail', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) })),
      );
      const appendLine = vi.fn();
      setOutputChannel({
        name: 'Review Plugin',
        appendLine,
        append: vi.fn(),
        clear: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn(),
        replace: vi.fn(),
      } as unknown as vscode.OutputChannel);
      const e1 = reviewerEntry();
      const e2 = { ...reviewerEntry(), id: 'rev-2' };
      e2.item = makeItem('rev-2', { source: { kind: 'reviewer', login: 'bob', severity: 'nit' } });
      setActiveEntries([e1, e2]);

      try {
        await upgradeReviewerAvatars([e1, e2]);
        const calls = appendLine.mock.calls.map((c) => c[0] as string);
        const summaryCall = calls.find((c) => c.includes('All 2 reviewer avatar fetch'));
        expect(summaryCall).toBeDefined();
      } finally {
        __resetOutputChannelForTests();
      }
    });
  });

  describe('reconcileEntries', () => {
    it('patches existing threads in place when ids are unchanged', () => {
      const e = makeEntry('id-1', { status: 'unresolved' });
      setActiveEntries([e]);
      const same = e.thread;

      const updatedItem = makeItem('id-1', {
        status: 'deferred',
      });
      reconcileEntries({ entries: [{ thread: same, id: 'id-1', item: updatedItem }] });

      expect(getActiveThreads()).toEqual([same]);
      expect(same.contextValue).toBe('review-finding-deferred');
      expect(findThreadById('id-1')?.item).toBe(updatedItem);
    });

    it('disposes threads for ids that vanished', () => {
      const e1 = makeEntry('id-1');
      const e2 = makeEntry('id-2');
      setActiveEntries([e1, e2]);

      reconcileEntries({ entries: [{ thread: e1.thread, id: 'id-1', item: e1.item }] });

      expect(e2.thread.dispose).toHaveBeenCalledTimes(1);
      expect(findThreadById('id-2')).toBeUndefined();
      expect(findIdByThread(e2.thread)).toBeUndefined();
      expect(getActiveThreads()).toEqual([e1.thread]);
    });

    it('registers brand-new ids as new entries', () => {
      const e1 = makeEntry('id-1');
      setActiveEntries([e1]);

      const newEntry = makeEntry('id-new');
      reconcileEntries({ entries: [e1, newEntry] });

      expect(findThreadById('id-new')?.thread).toBe(newEntry.thread);
      expect(findIdByThread(newEntry.thread)).toBe('id-new');
      expect(getActiveThreads()).toEqual([e1.thread, newEntry.thread]);
    });

    it('replaces a thread when the same id maps to a different thread object', () => {
      const e1 = makeEntry('id-1');
      setActiveEntries([e1]);

      const replacement = makeThread('replacement');
      reconcileEntries({
        entries: [{ thread: replacement, id: 'id-1', item: makeItem('id-1') }],
      });

      expect(e1.thread.dispose).toHaveBeenCalledTimes(1);
      expect(findThreadById('id-1')?.thread).toBe(replacement);
      expect(findIdByThread(replacement)).toBe('id-1');
      expect(findIdByThread(e1.thread)).toBeUndefined();
    });
  });
});
