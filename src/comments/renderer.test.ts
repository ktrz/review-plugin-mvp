import { describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import {
  HandoverDocumentSchema,
  type FindingItem,
  type HandoverDocument,
} from '../schema';
import { renderFindings } from './renderer';

const WORKSPACE = '/repo';

interface MakeFindingOpts {
  tag: string;
  locationKind?: 'file' | 'review-body';
  file?: string;
  line?: number;
}

const makeFinding = (opts: MakeFindingOpts): FindingItem => {
  const location =
    (opts.locationKind ?? 'file') === 'file'
      ? {
          kind: 'file' as const,
          file: opts.file ?? `src/${opts.tag}.ts`,
          line: opts.line ?? 10,
        }
      : { kind: 'review-body' as const };
  return {
    dirty: false,
    rawSource: `raw-${opts.tag}`,
    status: 'unresolved',
    source: { kind: 'auto-review', severity: 'critical' },
    location,
    reportedBy: ['auto-review'],
    comment: `comment-${opts.tag}`,
    analysis: `analysis-${opts.tag}`,
    recommendation: `recommendation-${opts.tag}`,
    options: [],
    resolution: '',
  } satisfies FindingItem;
};

const makeDoc = (items: FindingItem[]): HandoverDocument =>
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
    items,
  });

const makeFakeController = (): vscode.CommentController => {
  const fake: Partial<vscode.CommentController> = {
    id: 'reviewPlugin.findings',
    label: 'Review Plugin',
    createCommentThread: vi.fn(),
    dispose: vi.fn(),
  };
  return fake as vscode.CommentController;
};

const makeFakeThread = (tag: string): vscode.CommentThread => {
  const fake: Partial<vscode.CommentThread> = {
    label: tag,
    contextValue: 'review-finding',
    canReply: false,
    dispose: vi.fn(),
  };
  return fake as vscode.CommentThread;
};

describe('renderFindings', () => {
  describe('iteration and counts', () => {
    it('builds threads only for file-kind findings and counts review-body findings as skipped', () => {
      const findings = [
        makeFinding({ tag: 'one', locationKind: 'file' }),
        makeFinding({ tag: 'two', locationKind: 'review-body' }),
        makeFinding({ tag: 'three', locationKind: 'file' }),
        makeFinding({ tag: 'four', locationKind: 'review-body' }),
      ];
      const doc = makeDoc(findings);
      const controller = makeFakeController();
      const builtFor: FindingItem[] = [];
      const buildThread = vi.fn((deps: {
        finding: FindingItem;
        controller: vscode.CommentController;
        workspaceRoot: string;
      }) => {
        builtFor.push(deps.finding);
        return makeFakeThread(`thread-${builtFor.length}`);
      });

      const result = renderFindings({
        doc,
        controller,
        workspaceRoot: WORKSPACE,
        buildThread,
      });

      expect(result.fileThreads).toHaveLength(2);
      expect(result.skippedPrLevel).toBe(2);
      expect(buildThread).toHaveBeenCalledTimes(2);
      expect(builtFor.map((f) => f.comment)).toEqual([
        'comment-one',
        'comment-three',
      ]);
    });

    it('preserves doc.items order in fileThreads', () => {
      const findings = [
        makeFinding({ tag: 'a', file: 'src/a.ts', line: 1 }),
        makeFinding({ tag: 'b', locationKind: 'review-body' }),
        makeFinding({ tag: 'c', file: 'src/c.ts', line: 3 }),
        makeFinding({ tag: 'd', file: 'src/d.ts', line: 4 }),
      ];
      const doc = makeDoc(findings);
      const controller = makeFakeController();
      const threadsByTag = new Map<string, vscode.CommentThread>();
      const buildThread = vi.fn((deps: { finding: FindingItem }) => {
        const tag = deps.finding.comment.replace('comment-', '');
        const thread = makeFakeThread(tag);
        threadsByTag.set(tag, thread);
        return thread;
      });

      const { fileThreads } = renderFindings({
        doc,
        controller,
        workspaceRoot: WORKSPACE,
        buildThread,
      });

      expect(fileThreads).toEqual([
        threadsByTag.get('a'),
        threadsByTag.get('c'),
        threadsByTag.get('d'),
      ]);
    });

    it('passes controller and workspaceRoot through to buildThread, with finding from doc.items', () => {
      const finding = makeFinding({ tag: 'x', file: 'src/x.ts', line: 7 });
      const doc = makeDoc([finding]);
      const controller = makeFakeController();
      const calls: Array<{
        finding: FindingItem;
        controller: vscode.CommentController;
        workspaceRoot: string;
      }> = [];
      const buildThread = vi.fn((args: {
        finding: FindingItem;
        controller: vscode.CommentController;
        workspaceRoot: string;
      }) => {
        calls.push(args);
        return makeFakeThread('x');
      });

      renderFindings({
        doc,
        controller,
        workspaceRoot: WORKSPACE,
        buildThread,
      });

      expect(buildThread).toHaveBeenCalledTimes(1);
      expect(calls).toHaveLength(1);
      const callArg = calls[0];
      expect(callArg.controller).toBe(controller);
      expect(callArg.workspaceRoot).toBe(WORKSPACE);
      expect(callArg.finding).toBe(doc.items[0]);
    });

    it('returns zero counts for an empty document', () => {
      const doc = makeDoc([]);
      const controller = makeFakeController();
      const buildThread = vi.fn(() => makeFakeThread('unused'));

      const result = renderFindings({
        doc,
        controller,
        workspaceRoot: WORKSPACE,
        buildThread,
      });

      expect(result.fileThreads).toEqual([]);
      expect(result.skippedPrLevel).toBe(0);
      expect(buildThread).not.toHaveBeenCalled();
    });

    it('counts only review-body findings as skipped, never file findings', () => {
      const findings = [
        makeFinding({ tag: 'a', locationKind: 'review-body' }),
        makeFinding({ tag: 'b', locationKind: 'review-body' }),
        makeFinding({ tag: 'c', locationKind: 'review-body' }),
      ];
      const doc = makeDoc(findings);
      const controller = makeFakeController();
      const buildThread = vi.fn(() => makeFakeThread('unused'));

      const result = renderFindings({
        doc,
        controller,
        workspaceRoot: WORKSPACE,
        buildThread,
      });

      expect(result.fileThreads).toEqual([]);
      expect(result.skippedPrLevel).toBe(3);
      expect(buildThread).not.toHaveBeenCalled();
    });
  });

  describe('builder return-value handling', () => {
    it('skips a finding when buildThread returns null (defensive)', () => {
      const findings = [
        makeFinding({ tag: 'a', file: 'src/a.ts', line: 1 }),
        makeFinding({ tag: 'b', file: 'src/b.ts', line: 2 }),
      ];
      const doc = makeDoc(findings);
      const controller = makeFakeController();
      const thread = makeFakeThread('b');
      const buildThread = vi.fn((deps: { finding: FindingItem }) => {
        if (deps.finding.comment === 'comment-a') {
          return null;
        }
        return thread;
      });

      const result = renderFindings({
        doc,
        controller,
        workspaceRoot: WORKSPACE,
        buildThread,
      });

      expect(result.fileThreads).toEqual([thread]);
      expect(result.skippedPrLevel).toBe(0);
    });
  });

  describe('default builder', () => {
    it('uses the real buildThread which calls controller.createCommentThread for file findings', () => {
      const finding = makeFinding({ tag: 'x', file: 'src/x.ts', line: 5 });
      const doc = makeDoc([finding]);
      const createCommentThread = vi.fn((_uri, _range, _comments) => {
        return makeFakeThread('real');
      });
      const fake: Partial<vscode.CommentController> = {
        id: 'reviewPlugin.findings',
        label: 'Review Plugin',
        createCommentThread,
        dispose: vi.fn(),
      };
      const controller = fake as vscode.CommentController;

      const result = renderFindings({
        doc,
        controller,
        workspaceRoot: WORKSPACE,
      });

      expect(createCommentThread).toHaveBeenCalledTimes(1);
      expect(result.fileThreads).toHaveLength(1);
      expect(result.skippedPrLevel).toBe(0);
    });
  });
});
