import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { parseDocument } from './parse';
import { serializeDocument } from './serialize';
import { markResolved, markDeferred, markSkipped, markUnresolved } from './mutations';

const fixtureDir = join(__dirname, '../../fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf8');
}

describe('hybrid serialization', () => {
  const raw = loadFixture('pr-42-auto-review.md');

  it('untouched items emit bytes === rawSource', () => {
    const doc = parseDocument(raw);
    const serialized = serializeDocument(doc);

    // Split serialized back into item blocks
    // Each item should appear verbatim in the serialized output
    for (const item of doc.items) {
      expect(serialized).toContain(item.rawSource);
    }
  });

  it('mutated item is re-rendered with new status, untouched items preserve rawSource', () => {
    const doc = parseDocument(raw);
    // Mutate item 0 (status unresolved → resolved)
    const mutatedDoc = {
      ...doc,
      items: doc.items.map((item, idx) =>
        idx === 0 ? markResolved(item, item.resolution) : item,
      ),
    };
    const serialized = serializeDocument(mutatedDoc);

    // Mutated item should have new status in heading (on-disk format)
    expect(serialized).toContain('## [x] auto:critical — src/router.ts:42');

    // Mutated item should NOT contain old status heading
    expect(serialized).not.toContain('## [?] auto:critical — src/router.ts:42');

    // All untouched items (1-5) should appear verbatim
    for (let i = 1; i < doc.items.length; i++) {
      expect(serialized).toContain(doc.items[i].rawSource);
    }
  });

  it('dual-flag item with Note line, untouched → emitted bytes contain rawSource', () => {
    const doc = parseDocument(raw);
    // Item 3 is the dual-author item with Note line
    const item3 = doc.items[3];
    expect(item3.rawSource).toContain('**Note:** also flagged by @alice');

    const serialized = serializeDocument(doc);
    // rawSource is preserved verbatim (Note rides in it)
    expect(serialized).toContain(item3.rawSource);
  });

  it('dual-flag item mutated via markResolved → Note line dropped (lossy re-render)', () => {
    const doc = parseDocument(raw);
    const item3 = doc.items[3];
    const mutated = markResolved(item3, 'Resolved now');
    const mutatedDoc = {
      ...doc,
      items: doc.items.map((item, idx) => (idx === 3 ? mutated : item)),
    };
    const serialized = serializeDocument(mutatedDoc);

    // Mutated item is re-rendered — new status in on-disk format
    expect(serialized).toContain('## [x] auto:critical — src/router.ts:42');
    // Note line is dropped (not in structured fields)
    const noteOccurrences = (serialized.match(/\*\*Note:\*\* also flagged by @alice/g) ?? []).length;
    expect(noteOccurrences).toBe(0);
  });

  it('all items dirty → re-serializes without error', () => {
    const doc = parseDocument(raw);
    const mutatedDoc = {
      ...doc,
      items: doc.items.map(item => markDeferred(item)),
    };
    const serialized = serializeDocument(mutatedDoc);
    expect(() => parseDocument(serialized)).not.toThrow();
    const doc2 = parseDocument(serialized);
    for (let i = 0; i < doc.items.length; i++) {
      if (doc.items[i].options.length > 0) {
        expect(doc2.items[i].options).toEqual(doc.items[i].options);
      }
    }
  });

  it('first item dirty only → re-parse cleanly', () => {
    const doc = parseDocument(raw);
    const mutatedDoc = {
      ...doc,
      items: doc.items.map((item, idx) => idx === 0 ? markSkipped(item) : item),
    };
    const serialized = serializeDocument(mutatedDoc);
    const doc2 = parseDocument(serialized);
    expect(doc2.items[0].status).toBe('skipped');
    // Remaining items unchanged
    for (let i = 1; i < doc.items.length; i++) {
      expect(doc2.items[i].status).toBe(doc.items[i].status);
    }
  });

  it('last item dirty only → re-parse cleanly', () => {
    const doc = parseDocument(raw);
    const lastIdx = doc.items.length - 1;
    const mutatedDoc = {
      ...doc,
      items: doc.items.map((item, idx) => idx === lastIdx ? markUnresolved(item) : item),
    };
    const serialized = serializeDocument(mutatedDoc);
    const doc2 = parseDocument(serialized);
    expect(doc2.items[lastIdx].status).toBe('unresolved');
  });

  it('two consecutive dirty items (items 4 and 5) → re-parse cleanly', () => {
    const doc = parseDocument(raw);
    const mutatedDoc = {
      ...doc,
      items: doc.items.map((item, idx) =>
        idx === 4 || idx === 5 ? markResolved(item, 'addressed') : item,
      ),
    };
    const serialized = serializeDocument(mutatedDoc);
    const doc2 = parseDocument(serialized);
    expect(doc2.items[4].status).toBe('resolved');
    expect(doc2.items[5].status).toBe('resolved');
  });

  it('review-body reviewer item re-render: heading is review body, no :NN', () => {
    const doc = parseDocument(raw);
    // Item 1 is reviewer:@alice — review body
    const item1 = doc.items[1];
    const mutated = markResolved(item1, 'Acknowledged');
    const mutatedDoc = {
      ...doc,
      items: doc.items.map((item, idx) => idx === 1 ? mutated : item),
    };
    const serialized = serializeDocument(mutatedDoc);
    expect(serialized).toContain('## [x] reviewer:@alice — review body');
    // Should NOT contain file:line format for this item
    // The heading should not contain a colon-number after review body
    expect(serialized).not.toContain('review body:');
  });

  it('reviewer login in heading carries @, Source field shows kind only', () => {
    const doc = parseDocument(raw);
    // Item 5 is reviewer:@alice — src/types.ts:8 — force dirty to re-render
    const item5 = doc.items[5];
    const mutated = markResolved(item5, 'Fixed');
    const mutatedDoc = {
      ...doc,
      items: doc.items.map((item, idx) => idx === 5 ? mutated : item),
    };
    const serialized = serializeDocument(mutatedDoc);
    // Heading carries @alice
    expect(serialized).toContain('## [x] reviewer:@alice — src/types.ts:8');
    // Source field shows kind only (no login)
    expect(serialized).toContain('**Source:** reviewer');
    expect(serialized).not.toContain('**Source:** reviewer:@alice');
  });

  it('source counts in serialized output are derived correctly', () => {
    const doc = parseDocument(raw);
    const serialized = serializeDocument(doc);
    // The corrected fixture has 2 critical, 2 important, 2 suggestion/nit
    expect(serialized).toContain('4 auto-review findings, 2 human reviewer comments, 6 total (2 critical, 2 important, 2 suggestion/nit)');
  });
});
