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
  setActiveThreads,
} from './render-session';
import type { FindingItemWithId, ThreadEntry } from './thread-builder';
import {
  __resetOutputChannelForTests,
  setOutputChannel,
} from '../runtime/findings-state';

const makeThread = (label = 'thread'): vscode.CommentThread => {
  const fake: Partial<vscode.CommentThread> = {
    label,
    contextValue: '',
    collapsibleState: vscode.CommentThreadCollapsibleState.Collapsed,
    state: vscode.CommentThreadState.Unresolved,
    comments: [],
    dispose: vi.fn(),
  };
  return fake as vscode.CommentThread;
};

const makeItem = (
  id: string,
  overrides: Partial<FindingItemWithId> = {},
): FindingItemWithId => {
  const base: FindingItemWithId = {
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
  return { ...base, ...overrides } satisfies FindingItemWithId;
};

const makeEntry = (
  id: string,
  itemOverrides: Partial<FindingItemWithId> = {},
): ThreadEntry => ({
  thread: makeThread(`thread-${id}`),
  id,
  item: makeItem(id, itemOverrides),
});

describe('render-session', () => {
  beforeEach(() => {
    disposeAll();
  });

  describe('setActiveThreads', () => {
    it('installs threads into the registry', () => {
      const t1 = makeThread('a');
      const t2 = makeThread('b');
      setActiveThreads([t1, t2]);
      expect(getActiveThreads()).toEqual([t1, t2]);
    });

    it('disposes previously active threads in iteration order before replacing', () => {
      const order: string[] = [];
      const previous1Dispose = vi.fn(() => {
        order.push('p1');
      });
      const previous2Dispose = vi.fn(() => {
        order.push('p2');
      });
      const previous1Fake: Partial<vscode.CommentThread> = {
        label: 'p1',
        dispose: previous1Dispose,
      };
      const previous2Fake: Partial<vscode.CommentThread> = {
        label: 'p2',
        dispose: previous2Dispose,
      };
      const previous1 = previous1Fake as vscode.CommentThread;
      const previous2 = previous2Fake as vscode.CommentThread;
      setActiveThreads([previous1, previous2]);

      const next = makeThread('next');
      setActiveThreads([next]);

      expect(order).toEqual(['p1', 'p2']);
      expect(previous1Dispose).toHaveBeenCalledTimes(1);
      expect(previous2Dispose).toHaveBeenCalledTimes(1);
      expect(getActiveThreads()).toEqual([next]);
    });

    it('handles being called with an empty array (disposes existing, leaves registry empty)', () => {
      const t1 = makeThread();
      setActiveThreads([t1]);
      setActiveThreads([]);
      expect(t1.dispose).toHaveBeenCalledTimes(1);
      expect(getActiveThreads()).toEqual([]);
    });

    it('does not dispose the incoming threads', () => {
      const t1 = makeThread();
      setActiveThreads([t1]);
      expect(t1.dispose).not.toHaveBeenCalled();
    });
  });

  describe('disposeAll', () => {
    it('disposes every active thread and clears the registry', () => {
      const t1 = makeThread();
      const t2 = makeThread();
      setActiveThreads([t1, t2]);
      disposeAll();
      expect(t1.dispose).toHaveBeenCalledTimes(1);
      expect(t2.dispose).toHaveBeenCalledTimes(1);
      expect(getActiveThreads()).toEqual([]);
    });

    it('is safe to call when the registry is already empty', () => {
      expect(() => disposeAll()).not.toThrow();
      expect(getActiveThreads()).toEqual([]);
    });

    it('is safe to call twice in a row (double-dispose protection)', () => {
      const t1 = makeThread();
      setActiveThreads([t1]);
      disposeAll();
      expect(() => disposeAll()).not.toThrow();
      expect(t1.dispose).toHaveBeenCalledTimes(1);
      expect(getActiveThreads()).toEqual([]);
    });
  });

  describe('getActiveThreads', () => {
    it('returns the current registry contents', () => {
      const t = makeThread();
      setActiveThreads([t]);
      expect(getActiveThreads()).toEqual([t]);
    });

    it('returns an empty array before any setActiveThreads call', () => {
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

      setActiveThreads([throwing, ok]);
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

        setActiveThreads([throwing]);
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
    it('updates label, contextValue, state, collapsibleState in place AND updates registry entry item', () => {
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
      expect(e.thread.label).toBe('[resolved] critical · auto-review');
      expect(findThreadById('id-r')?.item).toBe(updatedItem);
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
