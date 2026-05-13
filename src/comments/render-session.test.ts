import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import {
  disposeAll,
  getActiveThreads,
  setActiveThreads,
} from './render-session';

const makeThread = (label = 'thread'): vscode.CommentThread => {
  const fake: Partial<vscode.CommentThread> = {
    label,
    dispose: vi.fn(),
  };
  return fake as vscode.CommentThread;
};

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
});
