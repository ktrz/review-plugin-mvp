import { describe, it, expect } from 'vitest';
import { applyDecision, ApplyDecisionError, type ThreadDecision } from './apply-decision';
import type { FindingItem, HandoverDocument } from '../schema';

const baseItem = {
  id: 'item-1',
  status: 'unresolved',
  source: { kind: 'auto-review', severity: 'critical' },
  location: { kind: 'file', file: 'src/foo.ts', line: 10 },
  reportedBy: ['auto-review'],
  comment: 'Something is wrong.',
  analysis: 'Very wrong.',
  recommendation: 'Fix it.',
  options: ['Option A', 'Option B'],
  resolution: '',
  rawSource: '## [?] auto:critical — src/foo.ts:10\n\n**Severity:** critical',
  dirty: false,
} satisfies Partial<FindingItem> as FindingItem;

const makeDoc = (items: FindingItem[]): HandoverDocument => ({
  header: {
    prUrl: 'https://github.com/example/repo/pull/1' as HandoverDocument['header']['prUrl'],
    prNumber: 1,
    branch: {
      head: { ref: 'feature' as HandoverDocument['header']['branch']['head']['ref'] },
      base: { ref: 'main' as HandoverDocument['header']['branch']['base']['ref'] },
    },
    generatedAt: '2026-05-13T00:00:00.000Z',
    status: 'pending',
  },
  items,
});

describe('applyDecision', () => {
  describe('decision → status mapping', () => {
    it('post → resolved with placeholder resolution', () => {
      const doc = makeDoc([baseItem]);
      const result = applyDecision(doc, 'item-1', 'post');
      const updated = result.items[0];
      expect(updated.status).toBe('resolved');
      expect(updated.resolution).toBe('(posted via plugin)');
      expect(updated.dirty).toBe(true);
    });

    it('dismiss → skipped', () => {
      const doc = makeDoc([baseItem]);
      const result = applyDecision(doc, 'item-1', 'dismiss');
      const updated = result.items[0];
      expect(updated.status).toBe('skipped');
      expect(updated.dirty).toBe(true);
    });

    it('discuss → deferred', () => {
      const doc = makeDoc([baseItem]);
      const result = applyDecision(doc, 'item-1', 'discuss');
      const updated = result.items[0];
      expect(updated.status).toBe('deferred');
      expect(updated.dirty).toBe(true);
    });

    it('unresolve → unresolved', () => {
      const resolved = {
        ...baseItem,
        status: 'resolved',
        resolution: 'foo bar',
      } satisfies Partial<FindingItem> as FindingItem;
      const doc = makeDoc([resolved]);
      const result = applyDecision(doc, 'item-1', 'unresolve');
      const updated = result.items[0];
      expect(updated.status).toBe('unresolved');
      expect(updated.dirty).toBe(true);
    });
  });

  describe('unresolve preserves resolution verbatim', () => {
    it('keeps existing resolution text on flip from resolved → unresolved', () => {
      const resolved = {
        ...baseItem,
        status: 'resolved',
        resolution: 'foo bar',
      } satisfies Partial<FindingItem> as FindingItem;
      const doc = makeDoc([resolved]);
      const result = applyDecision(doc, 'item-1', 'unresolve');
      expect(result.items[0].resolution).toBe('foo bar');
    });

    it('keeps existing resolution text on flip from skipped → unresolved', () => {
      const skipped = {
        ...baseItem,
        status: 'skipped',
        resolution: 'previously dismissed reason',
      } satisfies Partial<FindingItem> as FindingItem;
      const doc = makeDoc([skipped]);
      const result = applyDecision(doc, 'item-1', 'unresolve');
      expect(result.items[0].status).toBe('unresolved');
      expect(result.items[0].resolution).toBe('previously dismissed reason');
    });
  });

  describe('errors', () => {
    it('unknown findingId throws ApplyDecisionError { kind: "unknown-id" }', () => {
      const doc = makeDoc([baseItem]);
      let caught: unknown;
      try {
        applyDecision(doc, 'missing-id', 'post');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ApplyDecisionError);
      const error = caught as ApplyDecisionError;
      expect(error.kind).toBe('unknown-id');
      expect(error.findingId).toBe('missing-id');
    });

    it('garbage decision string throws ApplyDecisionError { kind: "unknown-decision" }', () => {
      const doc = makeDoc([baseItem]);
      let caught: unknown;
      try {
        applyDecision(doc, 'item-1', 'frobnicate' as ThreadDecision);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ApplyDecisionError);
      const error = caught as ApplyDecisionError;
      expect(error.kind).toBe('unknown-decision');
      expect(error.decision).toBe('frobnicate');
    });
  });

  describe('immutability', () => {
    it('does not mutate the input doc items array', () => {
      const items = [baseItem];
      const doc = makeDoc(items);
      const originalItemsRef = doc.items;
      const originalFirst = doc.items[0];

      const result = applyDecision(doc, 'item-1', 'post');

      expect(doc.items).toBe(originalItemsRef);
      expect(doc.items[0]).toBe(originalFirst);
      expect(doc.items[0].status).toBe('unresolved');
      expect(result).not.toBe(doc);
      expect(result.items).not.toBe(originalItemsRef);
    });

    it('returns a new items array reference', () => {
      const doc = makeDoc([baseItem]);
      const result = applyDecision(doc, 'item-1', 'dismiss');
      expect(result.items).not.toBe(doc.items);
    });

    it('preserves other items unchanged', () => {
      const second = {
        ...baseItem,
        id: 'item-2',
        location: { kind: 'file', file: 'src/bar.ts', line: 5 },
      } satisfies Partial<FindingItem> as FindingItem;
      const doc = makeDoc([baseItem, second]);
      const result = applyDecision(doc, 'item-1', 'post');
      expect(result.items[1]).toBe(doc.items[1]);
    });
  });
});
