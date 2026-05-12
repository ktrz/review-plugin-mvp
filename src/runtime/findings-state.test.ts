import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { HandoverDocumentSchema, type HandoverDocument } from '../schema';
import {
  clearState,
  getOutputChannel,
  getState,
  setOutputChannel,
  setState,
  type LoadedFindings,
} from './findings-state';

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
    items: [],
  });

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

describe('findings-state', () => {
  beforeEach(() => {
    clearState();
  });

  describe('state lifecycle', () => {
    it('returns null before any setState call', () => {
      expect(getState()).toBeNull();
    });

    it('returns the exact same reference set via setState (no clone)', () => {
      const doc = makeDoc();
      const next: LoadedFindings = {
        doc,
        mtime: 1234,
        filePath: '/tmp/pr-42-auto-review.md',
        prNumber: 42,
      };
      setState(next);
      const got = getState();
      expect(got).not.toBeNull();
      expect(got).toBe(next);
      expect(got?.doc).toBe(doc);
    });

    it('overwrites previous state on subsequent setState', () => {
      const first: LoadedFindings = {
        doc: makeDoc(),
        mtime: 1,
        filePath: '/a.md',
        prNumber: 1,
      };
      const second: LoadedFindings = {
        doc: makeDoc(),
        mtime: 2,
        filePath: '/b.md',
        prNumber: 2,
      };
      setState(first);
      setState(second);
      expect(getState()).toBe(second);
    });

    it('clearState resets state to null', () => {
      setState({
        doc: makeDoc(),
        mtime: 1,
        filePath: '/a.md',
        prNumber: 1,
      });
      clearState();
      expect(getState()).toBeNull();
    });
  });

  describe('output channel', () => {
    it('getOutputChannel throws when no channel has been set', () => {
      expect(() => getOutputChannel()).toThrow(/output channel/i);
    });

    it('returns the channel set via setOutputChannel', () => {
      const channel = makeChannel();
      setOutputChannel(channel);
      expect(getOutputChannel()).toBe(channel);
    });

    it('clearState does not affect the output channel', () => {
      const channel = makeChannel();
      setOutputChannel(channel);
      setState({
        doc: makeDoc(),
        mtime: 1,
        filePath: '/a.md',
        prNumber: 1,
      });
      clearState();
      expect(getOutputChannel()).toBe(channel);
      expect(getState()).toBeNull();
    });

    it('setOutputChannel can be called more than once and replaces the channel', () => {
      const first = makeChannel();
      const second = makeChannel();
      setOutputChannel(first);
      setOutputChannel(second);
      expect(getOutputChannel()).toBe(second);
    });
  });
});
