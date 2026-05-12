import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { parseDocument } from './parse';
import { serializeDocument } from './serialize';

const fixtureDir = join(__dirname, '../../fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf8');
}

describe('round-trip — parse → serialize → parse', () => {
  const raw = loadFixture('pr-42-auto-review.md');
  const doc1 = parseDocument(raw);
  const serialized = serializeDocument(doc1);
  const doc2 = parseDocument(serialized);

  it('re-parses without error', () => {
    expect(doc2).toBeDefined();
  });

  it('same item count', () => {
    expect(doc2.items).toHaveLength(doc1.items.length);
  });

  it('header prUrl preserved', () => {
    expect(doc2.header.prUrl).toBe(doc1.header.prUrl);
  });

  it('header branch head ref preserved', () => {
    expect(doc2.header.branch.head.ref).toBe(doc1.header.branch.head.ref);
  });

  it('header branch base ref preserved', () => {
    expect(doc2.header.branch.base.ref).toBe(doc1.header.branch.base.ref);
  });

  it('header branch head sha preserved', () => {
    expect(doc2.header.branch.head.sha).toBe(doc1.header.branch.head.sha);
  });

  it('header branch base sha preserved', () => {
    expect(doc2.header.branch.base.sha).toBe(doc1.header.branch.base.sha);
  });

  it('header generatedAt preserved', () => {
    expect(doc2.header.generatedAt).toBe(doc1.header.generatedAt);
  });

  it('header status preserved', () => {
    expect(doc2.header.status).toBe(doc1.header.status);
  });

  it('header sourceCounts preserved', () => {
    expect(doc2.header.sourceCounts).toEqual(doc1.header.sourceCounts);
  });

  // Per-item structural equality
  for (let i = 0; i < 6; i++) {
    describe(`item ${i}`, () => {
      it('status matches', () => {
        expect(doc2.items[i].status).toBe(doc1.items[i].status);
      });
      it('source matches', () => {
        expect(doc2.items[i].source).toEqual(doc1.items[i].source);
      });
      it('severity matches', () => {
        expect(doc2.items[i].severity).toBe(doc1.items[i].severity);
      });
      it('file matches', () => {
        expect(doc2.items[i].file).toBe(doc1.items[i].file);
      });
      it('line matches', () => {
        expect(doc2.items[i].line).toBe(doc1.items[i].line);
      });
      it('reportedBy matches', () => {
        expect(doc2.items[i].reportedBy).toEqual(doc1.items[i].reportedBy);
      });
      it('comment matches', () => {
        expect(doc2.items[i].comment).toBe(doc1.items[i].comment);
      });
      it('analysis matches', () => {
        expect(doc2.items[i].analysis).toBe(doc1.items[i].analysis);
      });
      it('recommendation matches', () => {
        expect(doc2.items[i].recommendation).toBe(doc1.items[i].recommendation);
      });
      it('options matches', () => {
        expect(doc2.items[i].options).toEqual(doc1.items[i].options);
      });
      it('resolution matches', () => {
        expect(doc2.items[i].resolution).toBe(doc1.items[i].resolution);
      });
    });
  }
});
