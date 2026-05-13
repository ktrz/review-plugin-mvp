import { describe, it, expect } from 'vitest';
import { stampMissingIds } from './stamp';
import { DocumentHeaderSchema, type FindingItem, type HandoverDocument } from './types';

const baseHeader: HandoverDocument['header'] = DocumentHeaderSchema.parse({
  prUrl: 'https://github.com/example/repo/pull/1',
  prNumber: 1,
  branch: {
    head: { ref: 'feat/x' },
    base: { ref: 'main' },
  },
  generatedAt: '2024-01-01T00:00:00Z',
  status: 'PENDING REVIEW',
});

function makeItem(opts: { id: string; comment?: string }): FindingItem {
  return {
    id: opts.id,
    status: 'unresolved',
    source: { kind: 'auto-review', severity: 'critical' },
    location: { kind: 'file', file: 'src/foo.ts', line: 10 },
    reportedBy: ['auto-review'],
    comment: opts.comment ?? 'comment',
    analysis: 'analysis',
    recommendation: 'recommendation',
    options: ['Option A'],
    resolution: '',
    rawSource: '## [?] auto:critical — src/foo.ts:10',
    dirty: false,
  } satisfies FindingItem;
}

function counter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

describe('stampMissingIds — all items missing id', () => {
  it('stamps every item with the generated id', () => {
    const doc: HandoverDocument = {
      header: baseHeader,
      items: [
        makeItem({ id: '', comment: 'a' }),
        makeItem({ id: '', comment: 'b' }),
        makeItem({ id: '', comment: 'c' }),
      ],
    };
    const out = stampMissingIds(doc, { generateId: counter('gen') });
    expect(out.items.map((i) => i.id)).toEqual(['gen-1', 'gen-2', 'gen-3']);
  });

  it('marks every stamped item dirty: true', () => {
    const doc: HandoverDocument = {
      header: baseHeader,
      items: [makeItem({ id: '' }), makeItem({ id: '' })],
    };
    const out = stampMissingIds(doc, { generateId: counter('x') });
    for (const it of out.items) {
      expect(it.dirty).toBe(true);
    }
  });
});

describe('stampMissingIds — all items already have id', () => {
  it('returns the input doc unchanged (referential identity)', () => {
    const doc: HandoverDocument = {
      header: baseHeader,
      items: [makeItem({ id: 'already-1' }), makeItem({ id: 'already-2' })],
    };
    let calls = 0;
    const out = stampMissingIds(doc, {
      generateId: () => {
        calls++;
        return 'should-not-fire';
      },
    });
    expect(out).toBe(doc);
    expect(calls).toBe(0);
  });

  it('preserves original dirty flag when no stamping needed', () => {
    const doc: HandoverDocument = {
      header: baseHeader,
      items: [makeItem({ id: 'kept' })],
    };
    const out = stampMissingIds(doc, { generateId: () => 'unused' });
    expect(out.items[0].dirty).toBe(false);
  });
});

describe('stampMissingIds — mixed items', () => {
  it('stamps only the missing ids; preserves existing ones verbatim', () => {
    const doc: HandoverDocument = {
      header: baseHeader,
      items: [
        makeItem({ id: 'keep-A' }),
        makeItem({ id: '' }),
        makeItem({ id: 'keep-B' }),
        makeItem({ id: '' }),
      ],
    };
    const out = stampMissingIds(doc, { generateId: counter('fresh') });
    expect(out.items.map((i) => i.id)).toEqual(['keep-A', 'fresh-1', 'keep-B', 'fresh-2']);
  });

  it('only newly-stamped items are flipped to dirty', () => {
    const doc: HandoverDocument = {
      header: baseHeader,
      items: [
        makeItem({ id: 'keep-A' }),
        makeItem({ id: '' }),
        makeItem({ id: 'keep-B' }),
      ],
    };
    const out = stampMissingIds(doc, { generateId: counter('fresh') });
    expect(out.items[0].dirty).toBe(false);
    expect(out.items[1].dirty).toBe(true);
    expect(out.items[2].dirty).toBe(false);
  });
});

describe('stampMissingIds — purity', () => {
  it('does not mutate the input document', () => {
    const doc: HandoverDocument = {
      header: baseHeader,
      items: [makeItem({ id: '' })],
    };
    const originalIdsBefore = doc.items.map((i) => i.id);
    const originalDirtyBefore = doc.items.map((i) => i.dirty);
    stampMissingIds(doc, { generateId: counter('mut') });
    expect(doc.items.map((i) => i.id)).toEqual(originalIdsBefore);
    expect(doc.items.map((i) => i.dirty)).toEqual(originalDirtyBefore);
  });

  it('returns a new items array reference when any stamping happened', () => {
    const doc: HandoverDocument = {
      header: baseHeader,
      items: [makeItem({ id: '' })],
    };
    const out = stampMissingIds(doc, { generateId: () => 'new-id' });
    expect(out.items).not.toBe(doc.items);
  });

  it('preserves options and reportedBy as fresh arrays (no shared refs)', () => {
    const item = makeItem({ id: '' });
    const doc: HandoverDocument = { header: baseHeader, items: [item] };
    const out = stampMissingIds(doc, { generateId: () => 'new-id' });
    expect(out.items[0].options).toEqual(item.options);
    expect(out.items[0].options).not.toBe(item.options);
    expect(out.items[0].reportedBy).toEqual(item.reportedBy);
    expect(out.items[0].reportedBy).not.toBe(item.reportedBy);
  });
});

describe('stampMissingIds — deterministic generator', () => {
  it('repeated runs with the same generator sequence yield identical ids', () => {
    const doc: HandoverDocument = {
      header: baseHeader,
      items: [makeItem({ id: '' }), makeItem({ id: '' })],
    };
    const out1 = stampMissingIds(doc, { generateId: counter('det') });
    const out2 = stampMissingIds(doc, { generateId: counter('det') });
    expect(out1.items.map((i) => i.id)).toEqual(out2.items.map((i) => i.id));
  });
});
