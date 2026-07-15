import { describe, it, expect } from 'vitest';
import {
  countByStatus,
  renderSummary,
  UnknownStatusError,
  type StatusCounts,
} from './finalize-summary';
import type { FindingItem, StatusMarker } from '../schema';

function makeItem(id: string, status: StatusMarker): FindingItem {
  return {
    id,
    status,
    source: { kind: 'auto-review', severity: 'critical' },
    location: { kind: 'file', file: 'src/foo.ts', line: 10 },
    reportedBy: [`reporter-${id}`],
    comment: 'c',
    analysis: 'a',
    recommendation: 'r',
    options: [],
    resolution: status === 'resolved' || status === 'custom' ? 'done' : '',
    rawSource: '## raw',
    dirty: false,
  };
}

describe('countByStatus', () => {
  it('returns all zeros for empty input', () => {
    expect(countByStatus([])).toEqual({
      resolved: 0,
      custom: 0,
      deferred: 0,
      skipped: 0,
      unresolved: 0,
    } satisfies StatusCounts);
  });

  it('counts mixed statuses exactly', () => {
    const items: FindingItem[] = [
      makeItem('1', 'resolved'),
      makeItem('2', 'resolved'),
      makeItem('3', 'custom'),
      makeItem('4', 'deferred'),
      makeItem('5', 'skipped'),
      makeItem('6', 'skipped'),
      makeItem('7', 'skipped'),
      makeItem('8', 'unresolved'),
    ];
    expect(countByStatus(items)).toEqual({
      resolved: 2,
      custom: 1,
      deferred: 1,
      skipped: 3,
      unresolved: 1,
    } satisfies StatusCounts);
  });

  it('throws UnknownStatusError for a forged unknown status', () => {
    const forged = { ...makeItem('x', 'unresolved'), status: 'bogus' as StatusMarker };
    const items: FindingItem[] = [forged];
    let caught: unknown;
    try {
      countByStatus(items);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnknownStatusError);
    if (caught instanceof UnknownStatusError) {
      expect(caught.status).toBe('bogus');
      expect(caught.message).toBe('Unknown finding status: bogus');
      expect(caught.name).toBe('UnknownStatusError');
    }
  });
});

describe('renderSummary', () => {
  it('produces the LOCKED block format byte-for-byte', () => {
    const result = renderSummary({
      filePath: '/tmp/x.md',
      counts: { resolved: 3, custom: 1, deferred: 2, skipped: 1, unresolved: 4 },
    });
    const expected = [
      'Review session — 11 items',
      '  resolved:   3  [x]',
      '  custom:     1  [~]',
      '  deferred:   2  [d]',
      '  skipped:    1  [-]',
      '  unresolved: 4  [?]',
      '',
      'File:    /tmp/x.md',
      'Command: claude "/execute-review-decisions /tmp/x.md"',
    ].join('\n');
    expect(result.block).toBe(expected);
  });

  it('cliCommand exactly equals the locked format', () => {
    const result = renderSummary({
      filePath: '/tmp/x.md',
      counts: { resolved: 0, custom: 0, deferred: 0, skipped: 0, unresolved: 0 },
    });
    expect(result.cliCommand).toBe('claude "/execute-review-decisions /tmp/x.md"');
  });

  it('line uses warning phrasing when unresolved + deferred > 0', () => {
    const result = renderSummary({
      filePath: '/tmp/x.md',
      counts: { resolved: 1, custom: 0, deferred: 2, skipped: 0, unresolved: 3 },
    });
    expect(result.line).toBe(
      '5 items still need attention (3 unresolved, 2 deferred) — finalize anyway?',
    );
  });

  it('line is the all-done variant when unresolved + deferred === 0', () => {
    const result = renderSummary({
      filePath: '/tmp/x.md',
      counts: { resolved: 2, custom: 1, deferred: 0, skipped: 1, unresolved: 0 },
    });
    expect(result.line).toBe('Review session complete: 4 items all addressed.');
  });

  it('line is the zero-items variant when there are no items', () => {
    const result = renderSummary({
      filePath: '/tmp/x.md',
      counts: { resolved: 0, custom: 0, deferred: 0, skipped: 0, unresolved: 0 },
    });
    expect(result.line).toBe('Review session: 0 items.');
  });
});
