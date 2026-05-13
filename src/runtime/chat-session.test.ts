import { describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import {
  ChatAlreadyInFlightError,
  createChatSessionStore,
} from './chat-session';

const makePlaceholder = (body = 'placeholder'): vscode.Comment => {
  const fake: Partial<vscode.Comment> = {
    body,
    author: { name: 'Review Agent' },
  };
  return fake as vscode.Comment;
};

describe('chat-session store', () => {
  describe('start / isInFlight / complete', () => {
    it('starts a session, marks it in-flight, and clears after complete', () => {
      const store = createChatSessionStore();
      expect(store.isInFlight('id-1')).toBe(false);

      const signal = store.start('id-1');
      expect(signal.aborted).toBe(false);
      expect(store.isInFlight('id-1')).toBe(true);

      store.complete('id-1');
      expect(store.isInFlight('id-1')).toBe(false);
    });

    it('isolates sessions per id', () => {
      const store = createChatSessionStore();
      store.start('a');
      expect(store.isInFlight('a')).toBe(true);
      expect(store.isInFlight('b')).toBe(false);
      store.complete('a');
    });
  });

  describe('start while already in-flight', () => {
    it('throws ChatAlreadyInFlightError when start is called twice for the same id', () => {
      const store = createChatSessionStore();
      store.start('dup');
      try {
        store.start('dup');
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ChatAlreadyInFlightError);
        expect((err as ChatAlreadyInFlightError).id).toBe('dup');
      }
      store.complete('dup');
    });
  });

  describe('abort', () => {
    it('aborts the AbortController signal and removes the entry', () => {
      const store = createChatSessionStore();
      const onAbort = vi.fn();
      const signal = store.start('cancel');
      signal.addEventListener('abort', onAbort);

      store.abort('cancel');

      expect(signal.aborted).toBe(true);
      expect(onAbort).toHaveBeenCalledTimes(1);
      expect(store.isInFlight('cancel')).toBe(false);
    });

    it('is a no-op for an unknown id', () => {
      const store = createChatSessionStore();
      expect(() => store.abort('nope')).not.toThrow();
      expect(store.isInFlight('nope')).toBe(false);
    });
  });

  describe('complete', () => {
    it('is a no-op for an unknown id', () => {
      const store = createChatSessionStore();
      expect(() => store.complete('nope')).not.toThrow();
    });

    it('lets start be called again after complete', () => {
      const store = createChatSessionStore();
      store.start('again');
      store.complete('again');
      const signal = store.start('again');
      expect(signal.aborted).toBe(false);
      store.complete('again');
    });
  });

  describe('placeholder set/get', () => {
    it('stores and retrieves a placeholder Comment for an in-flight session', () => {
      const store = createChatSessionStore();
      const placeholder = makePlaceholder('(thinking…)');
      store.start('p1');
      store.setPlaceholder('p1', placeholder);
      expect(store.getPlaceholder('p1')).toBe(placeholder);
      store.complete('p1');
    });

    it('returns undefined when no placeholder is set', () => {
      const store = createChatSessionStore();
      store.start('p2');
      expect(store.getPlaceholder('p2')).toBeUndefined();
      store.complete('p2');
    });

    it('returns undefined after complete clears the entry', () => {
      const store = createChatSessionStore();
      const placeholder = makePlaceholder();
      store.start('p3');
      store.setPlaceholder('p3', placeholder);
      store.complete('p3');
      expect(store.getPlaceholder('p3')).toBeUndefined();
    });

    it('returns undefined after abort clears the entry', () => {
      const store = createChatSessionStore();
      const placeholder = makePlaceholder();
      store.start('p4');
      store.setPlaceholder('p4', placeholder);
      store.abort('p4');
      expect(store.getPlaceholder('p4')).toBeUndefined();
    });

    it('setPlaceholder is a no-op when the session is not in-flight', () => {
      const store = createChatSessionStore();
      const placeholder = makePlaceholder();
      expect(() => store.setPlaceholder('absent', placeholder)).not.toThrow();
      expect(store.getPlaceholder('absent')).toBeUndefined();
    });
  });
});
