import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { parseDocument } from './parse';
import { serializeDocument } from './serialize';
import { withStatus } from './mutations';

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
    // Mutate item 0 (status [?] → [x])
    const mutatedDoc = {
      ...doc,
      items: doc.items.map((item, idx) =>
        idx === 0 ? withStatus(item, '[x]') : item,
      ),
    };
    const serialized = serializeDocument(mutatedDoc);

    // Mutated item should have new status in heading
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

  it('dual-flag item mutated via withStatus → Note line dropped (lossy re-render)', () => {
    const doc = parseDocument(raw);
    const item3 = doc.items[3];
    const mutated = withStatus(item3, '[x]');
    const mutatedDoc = {
      ...doc,
      items: doc.items.map((item, idx) => (idx === 3 ? mutated : item)),
    };
    const serialized = serializeDocument(mutatedDoc);

    // Mutated item is re-rendered — Note line should not appear in its section
    // The Note line might still appear if other untouched items happen to contain it,
    // but item 3's section should not include it. Since Note is not a structured field
    // and renderItem only emits structured fields, the Note is dropped.
    // We check that the new heading is present
    expect(serialized).toContain('## [x] auto:critical — src/router.ts:42');
    // And that the Note does NOT appear in the serialized output for this item
    // (since it was the only occurrence)
    const noteOccurrences = (serialized.match(/\*\*Note:\*\* also flagged by @alice/g) ?? []).length;
    expect(noteOccurrences).toBe(0);
  });
});
