import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { parseDocument, ParseError } from './parse';

// ---------------------------------------------------------------------------
// Helper — load fixture relative to project root
// ---------------------------------------------------------------------------
const fixtureDir = join(__dirname, '../../fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf8');
}

// ---------------------------------------------------------------------------
// Main fixture
// ---------------------------------------------------------------------------
describe('parseDocument — pr-42-auto-review.md', () => {
  const raw = loadFixture('pr-42-auto-review.md');
  const doc = parseDocument(raw);

  it('parses the PR URL', () => {
    expect(doc.header.prUrl).toBe('https://github.com/example/repo/pull/42');
  });

  it('parses branch head and base refs', () => {
    expect(doc.header.branch.head.ref).toBe('feat/user-auth');
    expect(doc.header.branch.base.ref).toBe('main');
  });

  it('parses head SHA', () => {
    expect(doc.header.branch.head.sha).toBe('abc1234567890abcdef1234567890abcdef12345');
  });

  it('parses base SHA', () => {
    expect(doc.header.branch.base.sha).toBe('def5678901234abcdef5678901234abcdef56789');
  });

  it('parses generatedAt', () => {
    expect(doc.header.generatedAt).toBe('2024-01-15T10:30:00Z');
  });

  it('parses status', () => {
    expect(doc.header.status).toBe('PENDING REVIEW');
  });

  it('parses source counts', () => {
    expect(doc.header.sourceCounts).toEqual({
      autoReviewFindings: 4,
      humanReviewerComments: 2,
      totalItems: 6,
      totalCritical: 1,
      totalImportant: 2,
      totalSuggestionOrNit: 3,
    });
  });

  it('parses exactly 6 items', () => {
    expect(doc.items).toHaveLength(6);
  });

  it('all items have dirty: false', () => {
    for (const item of doc.items) {
      expect(item.dirty).toBe(false);
    }
  });

  // Item 0: [?] auto:critical — src/router.ts:42
  describe('item 0 — critical auto-review with file:line', () => {
    const item = doc.items[0];

    it('status marker', () => expect(item.status).toBe('[?]'));
    it('source kind', () => expect(item.source.kind).toBe('auto-review'));
    it('severity', () => expect(item.severity).toBe('critical'));
    it('file', () => expect(item.file).toBe('src/router.ts'));
    it('line', () => expect(item.line).toBe(42));
    it('reportedBy length', () => expect(item.reportedBy).toHaveLength(1));
    it('reportedBy[0]', () => expect(item.reportedBy[0]).toBe('auto-review'));
    it('rawSource is non-empty', () => expect(item.rawSource.length).toBeGreaterThan(0));
    it('rawSource starts with heading', () => expect(item.rawSource).toMatch(/^## \[\?]/));
  });

  // Item 1: [x] reviewer:@alice — review body
  describe('item 1 — important reviewer review-body', () => {
    const item = doc.items[1];

    it('status marker', () => expect(item.status).toBe('[x]'));
    it('source kind', () => expect(item.source.kind).toBe('reviewer'));
    if (item.source.kind === 'reviewer') {
      it('login', () => expect(item.source.login).toBe('@alice'));
    }
    it('severity', () => expect(item.severity).toBe('important'));
    it('file is null (review body)', () => expect(item.file).toBeNull());
    it('line is null (review body)', () => expect(item.line).toBeNull());
    it('reportedBy[0]', () => expect(item.reportedBy[0]).toBe('@alice'));
  });

  // Item 2: [~] auto:important — src/api-client.ts:12
  describe('item 2 — important auto-review', () => {
    const item = doc.items[2];

    it('status marker', () => expect(item.status).toBe('[~]'));
    it('source kind', () => expect(item.source.kind).toBe('auto-review'));
    it('severity', () => expect(item.severity).toBe('important'));
    it('file', () => expect(item.file).toBe('src/api-client.ts'));
    it('line', () => expect(item.line).toBe(12));
  });

  // Item 3: [d] auto:critical — dual-author with Note line
  describe('item 3 — dual-author item with Note line', () => {
    const item = doc.items[3];

    it('status marker', () => expect(item.status).toBe('[d]'));
    it('source kind', () => expect(item.source.kind).toBe('auto-review'));
    it('severity', () => expect(item.severity).toBe('critical'));
    it('file', () => expect(item.file).toBe('src/router.ts'));
    it('line', () => expect(item.line).toBe(42));
    it('reportedBy includes both authors', () => {
      expect(item.reportedBy).toContain('auto-review');
      expect(item.reportedBy).toContain('@alice');
    });
    it('Note line is NOT in comment field', () => {
      expect(item.comment).not.toContain('**Note:**');
    });
    it('Note line is NOT in analysis field', () => {
      expect(item.analysis).not.toContain('**Note:**');
    });
    it('Note line rides in rawSource', () => {
      expect(item.rawSource).toContain('**Note:** also flagged by @alice');
    });
  });

  // Item 4: [-] auto:suggestion
  describe('item 4 — suggestion auto-review', () => {
    const item = doc.items[4];

    it('status marker', () => expect(item.status).toBe('[-]'));
    it('source kind', () => expect(item.source.kind).toBe('auto-review'));
    it('severity', () => expect(item.severity).toBe('suggestion'));
    it('file', () => expect(item.file).toBe('src/api-client.ts'));
    it('line', () => expect(item.line).toBe(5));
  });

  // Item 5: [?] reviewer:@alice — nit on src/types.ts
  describe('item 5 — nit reviewer with file:line', () => {
    const item = doc.items[5];

    it('status marker', () => expect(item.status).toBe('[?]'));
    it('source kind', () => expect(item.source.kind).toBe('reviewer'));
    it('severity', () => expect(item.severity).toBe('nit'));
    it('file', () => expect(item.file).toBe('src/types.ts'));
    it('line', () => expect(item.line).toBe(8));
    it('reportedBy[0]', () => expect(item.reportedBy[0]).toBe('@alice'));
  });
});

// ---------------------------------------------------------------------------
// SHA-absent variant
// ---------------------------------------------------------------------------
describe('parseDocument — SHA-absent header', () => {
  const raw = `# PR Review Handover: #99

**PR:** https://github.com/example/repo/pull/99
**Branch:** fix/typo → main
**Generated:** 2024-02-01T08:00:00Z
**Status:** COMPLETE
**Source counts:** 1 auto-review findings, 0 human reviewer comments, 1 total (0 critical, 0 important, 1 suggestion/nit)

---

## [x] auto:suggestion — src/types.ts:1

**Severity:** suggestion
**Source:** auto-review
**Reported by:** auto-review
**Comment:** Minor typo.
**Analysis:** Trivial.
**Recommendation:** Fix it.
**Options:**
**Resolution:** Fixed.
`;

  it('parses without throwing', () => {
    expect(() => parseDocument(raw)).not.toThrow();
  });

  it('head.sha is undefined', () => {
    const doc = parseDocument(raw);
    expect(doc.header.branch.head.sha).toBeUndefined();
  });

  it('base.sha is undefined', () => {
    const doc = parseDocument(raw);
    expect(doc.header.branch.base.sha).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------
describe('parseDocument — malformed branch', () => {
  const raw = `# PR Review Handover: #1

**PR:** https://github.com/example/repo/pull/1
**Branch:** feat/broken-no-arrow
**Generated:** 2024-01-01T00:00:00Z
**Status:** PENDING REVIEW
**Source counts:** 0 auto-review findings, 0 human reviewer comments, 0 total (0 critical, 0 important, 0 suggestion/nit)
`;

  it('throws ParseError', () => {
    expect(() => parseDocument(raw)).toThrow(ParseError);
  });

  it('ParseError state is IN_HEADER', () => {
    try {
      parseDocument(raw);
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      if (e instanceof ParseError) {
        expect(e.state).toBe('IN_HEADER');
      }
    }
  });
});

describe('parseDocument — malformed item heading', () => {
  const raw = `# PR Review Handover: #2

**PR:** https://github.com/example/repo/pull/2
**Branch:** feat/ok → main
**Generated:** 2024-01-01T00:00:00Z
**Status:** PENDING REVIEW
**Source counts:** 1 auto-review findings, 0 human reviewer comments, 1 total (1 critical, 0 important, 0 suggestion/nit)

---

## [INVALID] auto:critical — src/foo.ts:1

**Severity:** critical
**Source:** auto-review
**Reported by:** auto-review
**Comment:** Oops.
**Analysis:** Bad.
**Recommendation:** Fix.
**Options:**
**Resolution:** <!-- mark with [x] when resolved -->
`;

  it('throws ParseError', () => {
    expect(() => parseDocument(raw)).toThrow(ParseError);
  });
});
