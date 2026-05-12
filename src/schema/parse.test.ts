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

  it('parses prNumber from URL', () => {
    expect(doc.header.prNumber).toBe(42);
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

  it('sourceCounts is NOT on header (H9)', () => {
    expect((doc.header as Record<string, unknown>)['sourceCounts']).toBeUndefined();
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

    it('status marker', () => expect(item.status).toBe('unresolved'));
    it('source kind', () => expect(item.source.kind).toBe('auto-review'));
    it('severity in source', () => expect(item.source.severity).toBe('critical'));
    it('location kind', () => expect(item.location.kind).toBe('file'));
    it('location file', () => {
      if (item.location.kind === 'file') {
        expect(item.location.file).toBe('src/router.ts');
      }
    });
    it('location line', () => {
      if (item.location.kind === 'file') {
        expect(item.location.line).toBe(42);
      }
    });
    it('reportedBy length', () => expect(item.reportedBy).toHaveLength(1));
    it('reportedBy[0]', () => expect(item.reportedBy[0]).toBe('auto-review'));
    it('rawSource is non-empty', () => expect(item.rawSource.length).toBeGreaterThan(0));
    it('rawSource starts with heading', () => expect(item.rawSource).toMatch(/^## \[\?]/));
    it('comment field', () => {
      expect(item.comment).toContain('handleRequest');
    });
    it('analysis field', () => {
      expect(item.analysis).toContain('Bearer');
    });
    it('recommendation field', () => {
      expect(item.recommendation).toContain('401');
    });
    it('options deep equality', () => {
      expect(item.options).toEqual([
        'Option A: Add a `requireAuth` middleware that extracts and validates the token, returning 401 on failure.',
        'Option B: Validate inline per route handler and return early.',
      ]);
    });
  });

  // Item 1: [x] reviewer:@alice — review body
  describe('item 1 — important reviewer review-body', () => {
    const item = doc.items[1];

    it('status marker', () => expect(item.status).toBe('resolved'));
    it('source kind', () => expect(item.source.kind).toBe('reviewer'));
    it('login stored without @', () => {
      if (item.source.kind === 'reviewer') {
        expect(item.source.login).toBe('alice');
      }
    });
    it('severity in source', () => expect(item.source.severity).toBe('important'));
    it('location kind is review-body', () => expect(item.location.kind).toBe('review-body'));
    it('reportedBy[0]', () => expect(item.reportedBy[0]).toBe('@alice'));
  });

  // Item 2: [~] auto:important — src/api-client.ts:12
  describe('item 2 — important auto-review', () => {
    const item = doc.items[2];

    it('status marker', () => expect(item.status).toBe('custom'));
    it('source kind', () => expect(item.source.kind).toBe('auto-review'));
    it('severity in source', () => expect(item.source.severity).toBe('important'));
    it('location kind', () => expect(item.location.kind).toBe('file'));
    it('location file', () => {
      if (item.location.kind === 'file') {
        expect(item.location.file).toBe('src/api-client.ts');
      }
    });
    it('location line', () => {
      if (item.location.kind === 'file') {
        expect(item.location.line).toBe(12);
      }
    });
  });

  // Item 3: [d] auto:critical — dual-author with Note line
  describe('item 3 — dual-author item with Note line', () => {
    const item = doc.items[3];

    it('status marker', () => expect(item.status).toBe('deferred'));
    it('source kind', () => expect(item.source.kind).toBe('auto-review'));
    it('severity in source', () => expect(item.source.severity).toBe('critical'));
    it('location kind', () => expect(item.location.kind).toBe('file'));
    it('location file', () => {
      if (item.location.kind === 'file') {
        expect(item.location.file).toBe('src/router.ts');
      }
    });
    it('location line', () => {
      if (item.location.kind === 'file') {
        expect(item.location.line).toBe(42);
      }
    });
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
    it('comment field', () => {
      expect(item.comment).toContain('Unauthenticated DELETE');
    });
    it('analysis field', () => {
      expect(item.analysis).toContain('DELETE handler');
    });
    it('recommendation field', () => {
      expect(item.recommendation).toContain('requireAuth');
    });
    it('options deep equality', () => {
      expect(item.options).toEqual([
        'Option A: Shared `requireAuth` guard applied at route registration time.',
        'Option B: Inline check per handler.',
      ]);
    });
  });

  // Item 4: [-] auto:suggestion
  describe('item 4 — suggestion auto-review', () => {
    const item = doc.items[4];

    it('status marker', () => expect(item.status).toBe('skipped'));
    it('source kind', () => expect(item.source.kind).toBe('auto-review'));
    it('severity in source', () => expect(item.source.severity).toBe('suggestion'));
    it('location kind', () => expect(item.location.kind).toBe('file'));
    it('location file', () => {
      if (item.location.kind === 'file') {
        expect(item.location.file).toBe('src/api-client.ts');
      }
    });
    it('location line', () => {
      if (item.location.kind === 'file') {
        expect(item.location.line).toBe(5);
      }
    });
  });

  // Item 5: [?] reviewer:@alice — nit on src/types.ts
  describe('item 5 — nit reviewer with file:line', () => {
    const item = doc.items[5];

    it('status marker', () => expect(item.status).toBe('unresolved'));
    it('source kind', () => expect(item.source.kind).toBe('reviewer'));
    it('severity in source', () => expect(item.source.severity).toBe('nit'));
    it('login stored without @', () => {
      if (item.source.kind === 'reviewer') {
        expect(item.source.login).toBe('alice');
      }
    });
    it('location kind', () => expect(item.location.kind).toBe('file'));
    it('location file', () => {
      if (item.location.kind === 'file') {
        expect(item.location.file).toBe('src/types.ts');
      }
    });
    it('location line', () => {
      if (item.location.kind === 'file') {
        expect(item.location.line).toBe(8);
      }
    });
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

  it('prNumber is 99', () => {
    const doc = parseDocument(raw);
    expect(doc.header.prNumber).toBe(99);
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

  it('ParseError has lineNumber >= 0', () => {
    try {
      parseDocument(raw);
    } catch (e) {
      if (e instanceof ParseError) {
        expect(e.lineNumber).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('ParseError has offset >= 0', () => {
    try {
      parseDocument(raw);
    } catch (e) {
      if (e instanceof ParseError) {
        expect(e.offset).toBeGreaterThanOrEqual(0);
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

describe('parseDocument — missing Source counts header', () => {
  const raw = `# PR Review Handover: #3

**PR:** https://github.com/example/repo/pull/3
**Branch:** feat/ok → main
**Generated:** 2024-01-01T00:00:00Z
**Status:** PENDING REVIEW

---

## [x] auto:suggestion — src/foo.ts:1

**Severity:** suggestion
**Source:** auto-review
**Reported by:** auto-review
**Comment:** Minor.
**Analysis:** Trivial.
**Recommendation:** Fix.
**Options:**
**Resolution:** Done.
`;

  it('throws ParseError (C6)', () => {
    expect(() => parseDocument(raw)).toThrow(ParseError);
  });

  it('ParseError mentions Source counts', () => {
    try {
      parseDocument(raw);
    } catch (e) {
      if (e instanceof ParseError) {
        expect(e.message).toContain('Source counts');
      }
    }
  });
});

describe('parseDocument — reviewer item missing Severity field', () => {
  const raw = `# PR Review Handover: #4

**PR:** https://github.com/example/repo/pull/4
**Branch:** feat/ok → main
**Generated:** 2024-01-01T00:00:00Z
**Status:** PENDING REVIEW
**Source counts:** 0 auto-review findings, 1 human reviewer comments, 1 total (0 critical, 0 important, 1 suggestion/nit)

---

## [?] reviewer:@bob — src/foo.ts:1

**Source:** reviewer
**Reported by:** @bob
**Comment:** A comment.
**Analysis:** Some analysis.
**Recommendation:** Some rec.
**Options:**
**Resolution:**

---
`;

  it('throws ParseError (A3)', () => {
    expect(() => parseDocument(raw)).toThrow(ParseError);
  });

  it('ParseError mentions Severity', () => {
    try {
      parseDocument(raw);
    } catch (e) {
      if (e instanceof ParseError) {
        expect(e.message).toContain('Severity');
      }
    }
  });
});

describe('parseDocument — invalid auto-review severity in heading', () => {
  it('throws ParseError for auto:bogus (A1)', () => {
    const raw = `# PR Review Handover: #5

**PR:** https://github.com/example/repo/pull/5
**Branch:** feat/ok → main
**Generated:** 2024-01-01T00:00:00Z
**Status:** PENDING REVIEW
**Source counts:** 1 auto-review findings, 0 human reviewer comments, 1 total (0 critical, 0 important, 0 suggestion/nit)

---

## [?] auto:bogus — src/foo.ts:1

**Severity:** bogus
**Source:** auto-review
**Reported by:** auto-review
**Comment:** Something.
**Analysis:** Analysis.
**Recommendation:** Fix.
**Options:**
**Resolution:**

---
`;
    expect(() => parseDocument(raw)).toThrow(ParseError);
  });

  it('throws ParseError for auto:CRITICAL uppercase (A2)', () => {
    const raw = `# PR Review Handover: #6

**PR:** https://github.com/example/repo/pull/6
**Branch:** feat/ok → main
**Generated:** 2024-01-01T00:00:00Z
**Status:** PENDING REVIEW
**Source counts:** 1 auto-review findings, 0 human reviewer comments, 1 total (1 critical, 0 important, 0 suggestion/nit)

---

## [?] auto:CRITICAL — src/foo.ts:1

**Severity:** critical
**Source:** auto-review
**Reported by:** auto-review
**Comment:** Something.
**Analysis:** Analysis.
**Recommendation:** Fix.
**Options:**
**Resolution:**

---
`;
    // ITEM_HEADING_RE only allows [a-z]+ for severity, so CRITICAL won't match → ParseError
    expect(() => parseDocument(raw)).toThrow(ParseError);
  });
});

describe('parseDocument — empty string', () => {
  it('throws ParseError', () => {
    expect(() => parseDocument('')).toThrow(ParseError);
  });
});

describe('parseDocument — title only', () => {
  it('throws ParseError', () => {
    expect(() => parseDocument('# title only')).toThrow(ParseError);
  });
});

describe('parseDocument — CRLF normalization', () => {
  it('CRLF fixture parses same as LF', () => {
    const raw = loadFixture('pr-42-auto-review.md');
    const crlfRaw = raw.replace(/\n/g, '\r\n');
    const docLF = parseDocument(raw);
    const docCRLF = parseDocument(crlfRaw);
    expect(docCRLF.header.prUrl).toBe(docLF.header.prUrl);
    expect(docCRLF.items).toHaveLength(docLF.items.length);
    for (let i = 0; i < docLF.items.length; i++) {
      expect(docCRLF.items[i].status).toBe(docLF.items[i].status);
      expect(docCRLF.items[i].source).toEqual(docLF.items[i].source);
      expect(docCRLF.items[i].location).toEqual(docLF.items[i].location);
    }
  });
});

describe('parseDocument — non-standard prUrl', () => {
  it('throws ParseError when prUrl does not end in /pull/<n> (H4)', () => {
    const raw = `# PR Review Handover: #7

**PR:** https://github.com/example/repo/issues/7
**Branch:** feat/ok → main
**Generated:** 2024-01-01T00:00:00Z
**Status:** PENDING REVIEW
**Source counts:** 0 auto-review findings, 0 human reviewer comments, 0 total (0 critical, 0 important, 0 suggestion/nit)

---
`;
    expect(() => parseDocument(raw)).toThrow(ParseError);
  });
});

describe('parseDocument — item heading before first ---', () => {
  it('throws ParseError', () => {
    const raw = `# PR Review Handover: #8

**PR:** https://github.com/example/repo/pull/8
**Branch:** feat/ok → main
**Generated:** 2024-01-01T00:00:00Z
**Status:** PENDING REVIEW
**Source counts:** 0 auto-review findings, 0 human reviewer comments, 0 total (0 critical, 0 important, 0 suggestion/nit)

## [?] auto:critical — src/foo.ts:1

---
`;
    expect(() => parseDocument(raw)).toThrow(ParseError);
  });
});

describe('parseDocument — shuffled header order', () => {
  it('parses correctly regardless of field order', () => {
    const raw = `# PR Review Handover: #9

**Status:** PENDING REVIEW
**Branch:** feat/ok → main
**Generated:** 2024-01-01T00:00:00Z
**PR:** https://github.com/example/repo/pull/9
**Source counts:** 1 auto-review findings, 0 human reviewer comments, 1 total (1 critical, 0 important, 0 suggestion/nit)

---

## [?] auto:critical — src/foo.ts:1

**Severity:** critical
**Source:** auto-review
**Reported by:** auto-review
**Comment:** Something.
**Analysis:** Analysis.
**Recommendation:** Fix.
**Options:**
**Resolution:**

---
`;
    const doc = parseDocument(raw);
    expect(doc.header.prNumber).toBe(9);
    expect(doc.header.status).toBe('PENDING REVIEW');
    expect(doc.header.branch.head.ref).toBe('feat/ok');
    expect(doc.header.branch.base.ref).toBe('main');
  });
});

describe('parseDocument — reviewer login variants', () => {
  function makeReviewerDoc(login: string): string {
    return `# PR Review Handover: #10

**PR:** https://github.com/example/repo/pull/10
**Branch:** feat/ok → main
**Generated:** 2024-01-01T00:00:00Z
**Status:** PENDING REVIEW
**Source counts:** 0 auto-review findings, 1 human reviewer comments, 1 total (0 critical, 1 important, 0 suggestion/nit)

---

## [x] reviewer:@${login} — review body

**Severity:** important
**Source:** reviewer
**Reported by:** @${login}
**Comment:** Something.
**Analysis:** Analysis.
**Recommendation:** Fix.
**Options:**
**Resolution:** Done.

---
`;
  }

  it('@user-name is valid and stored without @', () => {
    const doc = parseDocument(makeReviewerDoc('user-name'));
    const item = doc.items[0];
    expect(item.source.kind).toBe('reviewer');
    if (item.source.kind === 'reviewer') {
      expect(item.source.login).toBe('user-name');
    }
  });

  it('@user.name is valid and stored without @', () => {
    const doc = parseDocument(makeReviewerDoc('user.name'));
    const item = doc.items[0];
    if (item.source.kind === 'reviewer') {
      expect(item.source.login).toBe('user.name');
    }
  });

  it('@user_name is valid and stored without @', () => {
    const doc = parseDocument(makeReviewerDoc('user_name'));
    const item = doc.items[0];
    if (item.source.kind === 'reviewer') {
      expect(item.source.login).toBe('user_name');
    }
  });
});

describe('parseDocument — multi-line resolution (C3+C4)', () => {
  it('captures multi-line resolution fully', () => {
    const raw = `# PR Review Handover: #11

**PR:** https://github.com/example/repo/pull/11
**Branch:** feat/ok → main
**Generated:** 2024-01-01T00:00:00Z
**Status:** PENDING REVIEW
**Source counts:** 1 auto-review findings, 0 human reviewer comments, 1 total (0 critical, 1 important, 0 suggestion/nit)

---

## [x] auto:important — src/foo.ts:1

**Severity:** important
**Source:** auto-review
**Reported by:** auto-review
**Comment:** Something.
**Analysis:** Analysis.
**Recommendation:** Fix.
**Options:**
**Resolution:** Line one.
Line two.
Line three.

---
`;
    const doc = parseDocument(raw);
    expect(doc.items[0].resolution).toBe('Line one.\nLine two.\nLine three.');
  });
});

describe('parseDocument — trailing separator absent', () => {
  it('parses a 1-item doc without trailing --- ok', () => {
    const raw = `# PR Review Handover: #12

**PR:** https://github.com/example/repo/pull/12
**Branch:** feat/ok → main
**Generated:** 2024-01-01T00:00:00Z
**Status:** PENDING REVIEW
**Source counts:** 1 auto-review findings, 0 human reviewer comments, 1 total (0 critical, 0 important, 1 suggestion/nit)

---

## [x] auto:suggestion — src/foo.ts:1

**Severity:** suggestion
**Source:** auto-review
**Reported by:** auto-review
**Comment:** Minor.
**Analysis:** Trivial.
**Recommendation:** Fix.
**Options:**
**Resolution:** Done.
`;
    const doc = parseDocument(raw);
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0].status).toBe('resolved');
  });
});

describe('parseDocument — source counts mismatch', () => {
  it('throws ParseError when source counts do not match items (H9)', () => {
    const raw = `# PR Review Handover: #13

**PR:** https://github.com/example/repo/pull/13
**Branch:** feat/ok → main
**Generated:** 2024-01-01T00:00:00Z
**Status:** PENDING REVIEW
**Source counts:** 2 auto-review findings, 0 human reviewer comments, 2 total (2 critical, 0 important, 0 suggestion/nit)

---

## [?] auto:critical — src/foo.ts:1

**Severity:** critical
**Source:** auto-review
**Reported by:** auto-review
**Comment:** Something.
**Analysis:** Analysis.
**Recommendation:** Fix.
**Options:**
**Resolution:**

---
`;
    // Only 1 item but source counts says 2
    expect(() => parseDocument(raw)).toThrow(ParseError);
  });
});

describe('parseDocument — reviewer Severity before Source field', () => {
  it('parses ok when Severity comes before Source', () => {
    const raw = `# PR Review Handover: #14

**PR:** https://github.com/example/repo/pull/14
**Branch:** feat/ok → main
**Generated:** 2024-01-01T00:00:00Z
**Status:** PENDING REVIEW
**Source counts:** 0 auto-review findings, 1 human reviewer comments, 1 total (0 critical, 1 important, 0 suggestion/nit)

---

## [x] reviewer:@carol — review body

**Severity:** important
**Source:** reviewer
**Reported by:** @carol
**Comment:** Something.
**Analysis:** Analysis.
**Recommendation:** Fix.
**Options:**
**Resolution:** Done.

---
`;
    const doc = parseDocument(raw);
    expect(doc.items[0].source.kind).toBe('reviewer');
    expect(doc.items[0].source.severity).toBe('important');
    if (doc.items[0].source.kind === 'reviewer') {
      expect(doc.items[0].source.login).toBe('carol');
    }
  });
});

describe('parseDocument — branch arrow variants', () => {
  function makeDoc(branchStr: string): string {
    return `# PR Review Handover: #15

**PR:** https://github.com/example/repo/pull/15
**Branch:** ${branchStr}
**Generated:** 2024-01-01T00:00:00Z
**Status:** PENDING REVIEW
**Source counts:** 0 auto-review findings, 0 human reviewer comments, 0 total (0 critical, 0 important, 0 suggestion/nit)

---
`;
  }

  it('ASCII -> arrow throws ParseError', () => {
    expect(() => parseDocument(makeDoc('feat/x -> main'))).toThrow(ParseError);
  });

  it('ASCII => arrow throws ParseError', () => {
    expect(() => parseDocument(makeDoc('feat/x => main'))).toThrow(ParseError);
  });

  it('pipe separator throws ParseError', () => {
    expect(() => parseDocument(makeDoc('feat/x | main'))).toThrow(ParseError);
  });
});

describe('parseDocument — item heading dash variants', () => {
  it('-- (double dash) instead of — (em dash) throws ParseError', () => {
    const raw = `# PR Review Handover: #16

**PR:** https://github.com/example/repo/pull/16
**Branch:** feat/ok → main
**Generated:** 2024-01-01T00:00:00Z
**Status:** PENDING REVIEW
**Source counts:** 1 auto-review findings, 0 human reviewer comments, 1 total (1 critical, 0 important, 0 suggestion/nit)

---

## [?] auto:critical -- src/foo.ts:1

**Severity:** critical
**Source:** auto-review
**Reported by:** auto-review
**Comment:** Something.
**Analysis:** Analysis.
**Recommendation:** Fix.
**Options:**
**Resolution:**

---
`;
    expect(() => parseDocument(raw)).toThrow(ParseError);
  });
});
