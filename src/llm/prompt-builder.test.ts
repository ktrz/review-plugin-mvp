import { describe, expect, it } from 'vitest';
import { buildPrompt } from './prompt-builder';
import type { FindingItem } from '../schema/types';
import type { HunkLoadResult } from './hunk-loader';

function makeItem(overrides: Partial<FindingItem> = {}): FindingItem {
  const base = {
    id: 'finding-1',
    status: 'deferred' as const,
    source: { kind: 'auto-review' as const, severity: 'important' as const },
    location: { kind: 'file' as const, file: 'src/foo.ts', line: 42 },
    reportedBy: ['auto-review'],
    comment: 'Potential null deref on `user`.',
    analysis: 'If `lookup` returns undefined, the `.name` access throws.',
    recommendation: 'Guard with `if (!user) return;`.',
    options: ['Option A: early return', 'Option B: optional chaining'],
    resolution: '',
    rawSource: '## raw',
    dirty: false as const,
  };
  return { ...base, ...overrides } as FindingItem;
}

function makeHunk(overrides: Partial<HunkLoadResult> = {}): HunkLoadResult {
  return {
    hunk: 'function lookup(id) {\n  return users[id];\n}',
    startLine: 40,
    lang: 'typescript',
    ...overrides,
  };
}

describe('buildPrompt', () => {
  it('produces a deterministic prompt for an empty transcript', () => {
    const result = buildPrompt({
      item: makeItem(),
      hunkResult: makeHunk(),
      transcript: [],
      userMessage: 'What is the risk of leaving this as-is?',
    });

    expect(result).toMatchInlineSnapshot(`
      "You are reviewing a single code review finding with the user.
      Only this finding; do not bring up other findings.
      Use Read or Grep tools if the seed hunk below is insufficient.

      ## Finding
      - File: src/foo.ts:42
      - Severity: important
      - Source: auto-review

      ### Comment
      Potential null deref on \`user\`.

      ### Analysis
      If \`lookup\` returns undefined, the \`.name\` access throws.

      ### Recommendation
      Guard with \`if (!user) return;\`.

      ### Options
      - Option A: early return
      - Option B: optional chaining

      ## Hunk (starting at line 40)
      \`\`\`typescript
      function lookup(id) {
        return users[id];
      }
      \`\`\`

      ## Conversation so far
      (none)

      ## User
      What is the risk of leaving this as-is?"
    `);
  });

  it('renders a non-empty transcript with role-tagged lines', () => {
    const result = buildPrompt({
      item: makeItem(),
      hunkResult: makeHunk(),
      transcript: [
        { role: 'user', content: 'Is this exploitable?' },
        { role: 'assistant', content: 'Only on the admin path.' },
      ],
      userMessage: 'How would we fix it?',
    });

    expect(result).toContain('## Conversation so far');
    expect(result).toContain('user: Is this exploitable?');
    expect(result).toContain('assistant: Only on the admin path.');
    expect(result).toMatch(/## User\nHow would we fix it\?$/);
  });

  it('omits the Options section when item has no options', () => {
    const result = buildPrompt({
      item: makeItem({ options: [] }),
      hunkResult: makeHunk(),
      transcript: [],
      userMessage: 'go',
    });

    expect(result).not.toContain('### Options');
  });

  it('preserves multi-line user message verbatim', () => {
    const message = 'Line one.\nLine two.\nLine three.';
    const result = buildPrompt({
      item: makeItem(),
      hunkResult: makeHunk(),
      transcript: [],
      userMessage: message,
    });

    expect(result.endsWith(message)).toBe(true);
  });

  it('uses the hunk lang in the fence', () => {
    const result = buildPrompt({
      item: makeItem(),
      hunkResult: makeHunk({ lang: 'python', hunk: 'def foo():\n    pass', startLine: 1 }),
      transcript: [],
      userMessage: 'x',
    });

    expect(result).toContain('```python\ndef foo():\n    pass\n```');
  });

  it('renders reviewer source with @login', () => {
    const result = buildPrompt({
      item: makeItem({
        source: { kind: 'reviewer', login: 'alice', severity: 'critical' },
      }),
      hunkResult: makeHunk(),
      transcript: [],
      userMessage: 'x',
    });

    expect(result).toContain('- Source: @alice');
    expect(result).toContain('- Severity: critical');
  });

  it('uses location file/line from the item, not from hunkResult.startLine', () => {
    const result = buildPrompt({
      item: makeItem({
        location: { kind: 'file', file: 'src/bar.ts', line: 7 },
      }),
      hunkResult: makeHunk({ startLine: 1 }),
      transcript: [],
      userMessage: 'x',
    });

    expect(result).toContain('- File: src/bar.ts:7');
    expect(result).toContain('## Hunk (starting at line 1)');
  });

  it('falls back to a generic file marker when location kind is review-body', () => {
    const result = buildPrompt({
      item: makeItem({
        location: { kind: 'review-body' },
      }),
      hunkResult: makeHunk(),
      transcript: [],
      userMessage: 'x',
    });

    expect(result).toContain('- File: (review body)');
  });
});
