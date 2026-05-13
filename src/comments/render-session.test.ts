import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import {
  disposeAll,
  getActiveThreads,
  setActiveThreads,
} from './render-session';
import {
  __resetOutputChannelForTests,
  setOutputChannel,
} from '../runtime/findings-state';

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
});
