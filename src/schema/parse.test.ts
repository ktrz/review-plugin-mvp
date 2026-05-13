import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { parseDocument, ParseError } from './parse';
import { serializeDocument } from './serialize';

const fixtureDir = join(__dirname, '../../fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf8');
}

function makeDoc({
  prNumber = 1,
  branch = 'feat/x → main',
  generated = '2024-01-01T00:00:00Z',
  status = 'PENDING REVIEW',
  sourceCounts = '0 auto-review findings, 0 human reviewer comments, 0 total (0 critical, 0 important, 0 suggestion/nit)',
  body = '',
}: {
  prNumber?: number;
  branch?: string;
  generated?: string;
  status?: string;
  sourceCounts?: string;
  body?: string;
} = {}): string {
  return `# PR Review Handover: #${prNumber}

**PR:** https://github.com/example/repo/pull/${prNumber}
**Branch:** ${branch}
**Generated:** ${generated}
**Status:** ${status}
**Source counts:** ${sourceCounts}

${body}`;
}

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

  it('sourceCounts is NOT on header', () => {
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

  describe('item 0 — critical auto-review with file:line', () => {
    const item = doc.items[0];
    if (item.dirty !== false) { throw new Error('test fixture expected clean'); }

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

  describe('item 3 — dual-author item with Note line', () => {
    const item = doc.items[3];
    if (item.dirty !== false) { throw new Error('test fixture expected clean'); }

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

describe('parseDocument — malformed branch', () => {
  const raw = makeDoc({ prNumber: 1, branch: 'feat/broken-no-arrow' });

  it('throws ParseError', () => {
    expect(() => parseDocument(raw)).toThrow(ParseError);
  });

  it('ParseError has exact state, lineNumber, offset', () => {
    try {
      parseDocument(raw);
      throw new Error('expected parseDocument to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      if (e instanceof ParseError) {
        expect(e.state).toBe('IN_HEADER');
        expect(e.lineNumber).toBe(4);
        const branchLineOffset = raw.indexOf('**Branch:**');
        expect(e.offset).toBe(branchLineOffset);
      }
    }
  });
});

describe('parseDocument — malformed item heading', () => {
  const raw = makeDoc({
    prNumber: 2,
    sourceCounts: '1 auto-review findings, 0 human reviewer comments, 1 total (1 critical, 0 important, 0 suggestion/nit)',
    body: `---

## [INVALID] auto:critical — src/foo.ts:1

**Severity:** critical
**Source:** auto-review
**Reported by:** auto-review
**Comment:** Oops.
**Analysis:** Bad.
**Recommendation:** Fix.
**Options:**
**Resolution:** <!-- mark with [x] when resolved -->
`,
  });

  it('throws ParseError with state BETWEEN_ITEMS', () => {
    try {
      parseDocument(raw);
      throw new Error('expected parseDocument to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      if (e instanceof ParseError) {
        expect(e.state).toBe('BETWEEN_ITEMS');
      }
    }
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

  it('throws ParseError', () => {
    expect(() => parseDocument(raw)).toThrow(ParseError);
  });

  it('ParseError mentions Source counts', () => {
    try {
      parseDocument(raw);
      throw new Error('expected parseDocument to throw');
    } catch (e) {
      if (e instanceof ParseError) {
        expect(e.message).toContain('Source counts');
        expect(e.state).toBe('IN_HEADER');
      }
    }
  });
});

describe('parseDocument — reviewer item missing Severity field', () => {
  const raw = makeDoc({
    prNumber: 4,
    sourceCounts: '0 auto-review findings, 1 human reviewer comments, 1 total (0 critical, 0 important, 1 suggestion/nit)',
    body: `---

## [?] reviewer:@bob — src/foo.ts:1

**Source:** reviewer
**Reported by:** @bob
**Comment:** A comment.
**Analysis:** Some analysis.
**Recommendation:** Some rec.
**Options:**
**Resolution:**

---
`,
  });

  it('throws ParseError', () => {
    expect(() => parseDocument(raw)).toThrow(ParseError);
  });

  it('ParseError mentions Severity and state is IN_ITEM_FIELDS', () => {
    try {
      parseDocument(raw);
      throw new Error('expected parseDocument to throw');
    } catch (e) {
      if (e instanceof ParseError) {
        expect(e.message).toContain('Severity');
        expect(e.state).toBe('IN_ITEM_FIELDS');
      }
    }
  });
});

describe('parseDocument — invalid auto-review severity in heading', () => {
  it('throws ParseError for auto:bogus', () => {
    const raw = makeDoc({
      prNumber: 5,
      sourceCounts: '1 auto-review findings, 0 human reviewer comments, 1 total (0 critical, 0 important, 0 suggestion/nit)',
      body: `---

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
`,
    });
    expect(() => parseDocument(raw)).toThrow(ParseError);
  });

  it('throws ParseError for auto:CRITICAL uppercase', () => {
    const raw = makeDoc({
      prNumber: 6,
      sourceCounts: '1 auto-review findings, 0 human reviewer comments, 1 total (1 critical, 0 important, 0 suggestion/nit)',
      body: `---

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
`,
    });
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
  it('throws ParseError when prUrl does not end in /pull/<n>', () => {
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

describe('parseDocument — multi-line resolution', () => {
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
  it('throws ParseError when source counts do not match items', () => {
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
  function makeBranchDoc(branchStr: string): string {
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
    expect(() => parseDocument(makeBranchDoc('feat/x -> main'))).toThrow(ParseError);
  });

  it('ASCII => arrow throws ParseError', () => {
    expect(() => parseDocument(makeBranchDoc('feat/x => main'))).toThrow(ParseError);
  });

  it('pipe separator throws ParseError', () => {
    expect(() => parseDocument(makeBranchDoc('feat/x | main'))).toThrow(ParseError);
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

describe('parseDocument — missing Reported by field', () => {
  const itemBody = `---

## [?] auto:critical — src/foo.ts:1

**Severity:** critical
**Source:** auto-review
**Comment:** Something.
**Analysis:** Analysis.
**Recommendation:** Fix.
**Options:**
**Resolution:**

---
`;
  const raw = makeDoc({
    prNumber: 17,
    sourceCounts: '1 auto-review findings, 0 human reviewer comments, 1 total (1 critical, 0 important, 0 suggestion/nit)',
    body: itemBody,
  });

  it('throws ParseError', () => {
    expect(() => parseDocument(raw)).toThrow(ParseError);
  });

  it('ParseError has state IN_ITEM_FIELDS and points at item startOffset', () => {
    try {
      parseDocument(raw);
      throw new Error('expected parseDocument to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      if (e instanceof ParseError) {
        expect(e.state).toBe('IN_ITEM_FIELDS');
        expect(e.message).toContain('Reported by');
        const itemHeadingOffset = raw.indexOf('## [?] auto:critical');
        expect(e.offset).toBe(itemHeadingOffset);
      }
    }
  });
});

describe('parseDocument — unknown field in item', () => {
  const raw = makeDoc({
    prNumber: 18,
    sourceCounts: '1 auto-review findings, 0 human reviewer comments, 1 total (1 critical, 0 important, 0 suggestion/nit)',
    body: `---

## [?] auto:critical — src/foo.ts:1

**Severity:** critical
**Source:** auto-review
**Reported by:** auto-review
**UnknownField:** value
**Comment:** Something.
**Analysis:** Analysis.
**Recommendation:** Fix.
**Options:**
**Resolution:**

---
`,
  });

  it('throws ParseError with state IN_ITEM_FIELDS', () => {
    try {
      parseDocument(raw);
      throw new Error('expected parseDocument to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      if (e instanceof ParseError) {
        expect(e.state).toBe('IN_ITEM_FIELDS');
        expect(e.message).toContain('UnknownField');
        const unknownLineOffset = raw.indexOf('**UnknownField:**');
        expect(e.offset).toBe(unknownLineOffset);
      }
    }
  });
});

describe('parseDocument — non-blank non-field line in item body', () => {
  const raw = makeDoc({
    prNumber: 19,
    sourceCounts: '1 auto-review findings, 0 human reviewer comments, 1 total (1 critical, 0 important, 0 suggestion/nit)',
    body: `---

## [?] auto:critical — src/foo.ts:1

**Severity:** critical
**Source:** auto-review
**Reported by:** auto-review
**Comment:** Something.
This is a paragraph.
**Analysis:** Analysis.
**Recommendation:** Fix.
**Options:**
**Resolution:**

---
`,
  });

  it('throws ParseError with state IN_ITEM_FIELDS', () => {
    try {
      parseDocument(raw);
      throw new Error('expected parseDocument to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      if (e instanceof ParseError) {
        expect(e.state).toBe('IN_ITEM_FIELDS');
        const paragraphLineOffset = raw.indexOf('This is a paragraph.');
        expect(e.offset).toBe(paragraphLineOffset);
      }
    }
  });
});

describe('parseDocument — unexpected field in options block', () => {
  const raw = makeDoc({
    prNumber: 20,
    sourceCounts: '1 auto-review findings, 0 human reviewer comments, 1 total (1 critical, 0 important, 0 suggestion/nit)',
    body: `---

## [?] auto:critical — src/foo.ts:1

**Severity:** critical
**Source:** auto-review
**Reported by:** auto-review
**Comment:** Something.
**Analysis:** Analysis.
**Recommendation:** Fix.
**Options:**
- Option A
**Severity:** critical
**Resolution:**

---
`,
  });

  it('throws ParseError with state IN_OPTIONS', () => {
    try {
      parseDocument(raw);
      throw new Error('expected parseDocument to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      if (e instanceof ParseError) {
        expect(e.state).toBe('IN_OPTIONS');
        expect(e.message).toContain('Severity');
        const secondSeverityLine = raw.lastIndexOf('**Severity:**');
        expect(e.offset).toBe(secondSeverityLine);
      }
    }
  });
});

describe('parseDocument — invalid generatedAt', () => {
  const raw = makeDoc({
    prNumber: 21,
    generated: 'January 15 2024',
    sourceCounts: '0 auto-review findings, 0 human reviewer comments, 0 total (0 critical, 0 important, 0 suggestion/nit)',
    body: '---\n',
  });

  it('throws ParseError wrapping ZodError', () => {
    try {
      parseDocument(raw);
      throw new Error('expected parseDocument to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      if (e instanceof ParseError) {
        expect(e.message).toContain('Schema validation failed');
        expect(e.cause).toBeDefined();
      }
    }
  });
});

describe('parseDocument — resolved status with empty resolution', () => {
  const raw = makeDoc({
    prNumber: 22,
    sourceCounts: '1 auto-review findings, 0 human reviewer comments, 1 total (1 critical, 0 important, 0 suggestion/nit)',
    body: `---

## [x] auto:critical — src/foo.ts:1

**Severity:** critical
**Source:** auto-review
**Reported by:** auto-review
**Comment:** Something.
**Analysis:** Analysis.
**Recommendation:** Fix.
**Options:**
**Resolution:**

---
`,
  });

  it('throws ParseError wrapping ZodError', () => {
    try {
      parseDocument(raw);
      throw new Error('expected parseDocument to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      if (e instanceof ParseError) {
        expect(e.message).toContain('Schema validation failed');
      }
    }
  });
});

describe('parseDocument — custom status with empty resolution', () => {
  const raw = makeDoc({
    prNumber: 23,
    sourceCounts: '1 auto-review findings, 0 human reviewer comments, 1 total (1 critical, 0 important, 0 suggestion/nit)',
    body: `---

## [~] auto:critical — src/foo.ts:1

**Severity:** critical
**Source:** auto-review
**Reported by:** auto-review
**Comment:** Something.
**Analysis:** Analysis.
**Recommendation:** Fix.
**Options:**
**Resolution:**

---
`,
  });

  it('throws ParseError wrapping ZodError', () => {
    expect(() => parseDocument(raw)).toThrow(ParseError);
  });
});

describe('parseDocument — empty comment value', () => {
  const raw = makeDoc({
    prNumber: 24,
    sourceCounts: '1 auto-review findings, 0 human reviewer comments, 1 total (1 critical, 0 important, 0 suggestion/nit)',
    body: `---

## [?] auto:critical — src/foo.ts:1

**Severity:** critical
**Source:** auto-review
**Reported by:** auto-review
**Comment:**
**Analysis:** Analysis.
**Recommendation:** Fix.
**Options:**
**Resolution:**

---
`,
  });

  it('throws ParseError wrapping ZodError', () => {
    try {
      parseDocument(raw);
      throw new Error('expected parseDocument to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      if (e instanceof ParseError) {
        expect(e.message).toContain('Schema validation failed');
      }
    }
  });
});

describe('parseDocument — Id field on item', () => {
  const itemBody = `---

## [?] auto:critical — src/foo.ts:1

**Severity:** critical
**Source:** auto-review
**Reported by:** auto-review
**Id:** 11111111-2222-3333-4444-555555555555
**Comment:** Something.
**Analysis:** Analysis.
**Recommendation:** Fix.
**Options:**
**Resolution:**

---
`;
  const raw = makeDoc({
    prNumber: 25,
    sourceCounts: '1 auto-review findings, 0 human reviewer comments, 1 total (1 critical, 0 important, 0 suggestion/nit)',
    body: itemBody,
  });

  it('parses the Id into item.id', () => {
    const doc = parseDocument(raw);
    expect(doc.items[0].id).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('round-trips the Id through serialize → parse', () => {
    const doc = parseDocument(raw);
    const item = doc.items[0];
    if (item.dirty !== false) { throw new Error('expected clean parse result'); }
    // Force a re-render by marking dirty via a status mutation surrogate: rebuild the item dirty.
    const dirtyDoc = {
      ...doc,
      items: doc.items.map((it) => {
        if (it.dirty !== false) { return it; }
        return { ...it, dirty: true as const };
      }),
    };
    const out = serializeDocument(dirtyDoc);
    expect(out).toContain('**Id:** 11111111-2222-3333-4444-555555555555');
    const reparsed = parseDocument(out);
    expect(reparsed.items[0].id).toBe('11111111-2222-3333-4444-555555555555');
  });
});

describe('parseDocument — id absent in input', () => {
  const itemBody = `---

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
  const raw = makeDoc({
    prNumber: 26,
    sourceCounts: '1 auto-review findings, 0 human reviewer comments, 1 total (1 critical, 0 important, 0 suggestion/nit)',
    body: itemBody,
  });

  it('parses successfully with id populated as empty string (stamper runs later)', () => {
    const doc = parseDocument(raw);
    expect(doc.items[0].id).toBe('');
  });
});

describe('parseDocument — Chat field', () => {
  function makeChatDoc(chatBlock: string, prNumber = 30): string {
    return `# PR Review Handover: #${prNumber}

**PR:** https://github.com/example/repo/pull/${prNumber}
**Branch:** feat/ok → main
**Generated:** 2024-01-01T00:00:00Z
**Status:** PENDING REVIEW
**Source counts:** 1 auto-review findings, 0 human reviewer comments, 1 total (1 critical, 0 important, 0 suggestion/nit)

---

## [d] auto:critical — src/foo.ts:1

**Severity:** critical
**Source:** auto-review
**Reported by:** auto-review
**Id:** 11111111-2222-3333-4444-555555555555
**Comment:** Something.
**Analysis:** Analysis.
**Recommendation:** Fix.
**Options:**
${chatBlock}**Resolution:**

---
`;
  }

  it('parses empty Chat block — chat is absent', () => {
    const doc = parseDocument(makeChatDoc('**Chat:**\n'));
    expect(doc.items[0].chat).toBeUndefined();
  });

  it('parses a single user message', () => {
    const doc = parseDocument(
      makeChatDoc('**Chat:**\n- user: hello there\n'),
    );
    expect(doc.items[0].chat).toEqual([
      { role: 'user', content: 'hello there' },
    ]);
  });

  it('parses alternating user/assistant messages', () => {
    const doc = parseDocument(
      makeChatDoc(
        '**Chat:**\n- user: ping\n- assistant: pong\n- user: again\n',
      ),
    );
    expect(doc.items[0].chat).toEqual([
      { role: 'user', content: 'ping' },
      { role: 'assistant', content: 'pong' },
      { role: 'user', content: 'again' },
    ]);
  });

  it('parses multi-line content via two-space continuation', () => {
    const doc = parseDocument(
      makeChatDoc(
        '**Chat:**\n- user: line one\n  line two\n  line three\n- assistant: ack\n',
      ),
    );
    expect(doc.items[0].chat).toEqual([
      { role: 'user', content: 'line one\nline two\nline three' },
      { role: 'assistant', content: 'ack' },
    ]);
  });

  it('throws ParseError with state IN_CHAT for an unknown role', () => {
    const raw = makeChatDoc('**Chat:**\n- bogus: oops\n');
    try {
      parseDocument(raw);
      throw new Error('expected parseDocument to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      if (e instanceof ParseError) {
        expect(e.state).toBe('IN_CHAT');
        expect(e.message).toContain('chat role');
        const badLineOffset = raw.indexOf('- bogus:');
        expect(e.offset).toBe(badLineOffset);
      }
    }
  });
});

describe('parseDocument — unknown field alongside Id', () => {
  const itemBody = `---

## [?] auto:critical — src/foo.ts:1

**Severity:** critical
**Source:** auto-review
**Reported by:** auto-review
**Id:** 11111111-2222-3333-4444-555555555555
**UnknownField:** value
**Comment:** Something.
**Analysis:** Analysis.
**Recommendation:** Fix.
**Options:**
**Resolution:**

---
`;
  const raw = makeDoc({
    prNumber: 27,
    sourceCounts: '1 auto-review findings, 0 human reviewer comments, 1 total (1 critical, 0 important, 0 suggestion/nit)',
    body: itemBody,
  });

  it('throws ParseError pointing at the UnknownField line', () => {
    try {
      parseDocument(raw);
      throw new Error('expected parseDocument to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      if (e instanceof ParseError) {
        expect(e.state).toBe('IN_ITEM_FIELDS');
        expect(e.message).toBe('Unknown field in item: **UnknownField:**');
        const unknownLineOffset = raw.indexOf('**UnknownField:**');
        expect(e.offset).toBe(unknownLineOffset);
      }
    }
  });
});
