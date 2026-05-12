import { describe, it, expect } from 'vitest';
import { markResolved, markCustom, markDeferred, markSkipped, markUnresolved, withResolution } from './mutations';
import type { FindingItem } from './types';

// A minimal FindingItem fixture for mutation tests
const baseItem: FindingItem = {
  status: 'unresolved',
  source: { kind: 'auto-review', severity: 'critical' },
  location: { kind: 'file', file: 'src/foo.ts', line: 10 },
  reportedBy: ['auto-review'],
  comment: 'Something is wrong.',
  analysis: 'Very wrong.',
  recommendation: 'Fix it.',
  options: ['Option A: Do X', 'Option B: Do Y'],
  resolution: '',
  rawSource: '## [?] auto:critical — src/foo.ts:10\n\n**Severity:** critical',
  dirty: false,
};

describe('markResolved', () => {
  it('returns a new object reference', () => {
    const result = markResolved(baseItem, 'Done');
    expect(result).not.toBe(baseItem);
  });

  it('sets status to resolved', () => {
    const result = markResolved(baseItem, 'Done');
    expect(result.status).toBe('resolved');
  });

  it('sets the resolution text', () => {
    const result = markResolved(baseItem, 'Fixed in PR #99');
    expect(result.resolution).toBe('Fixed in PR #99');
  });

  it('sets dirty: true', () => {
    const result = markResolved(baseItem, 'Done');
    expect(result.dirty).toBe(true);
  });

  it('does NOT mutate the original status', () => {
    markResolved(baseItem, 'Done');
    expect(baseItem.status).toBe('unresolved');
  });

  it('does NOT mutate the original dirty flag', () => {
    markResolved(baseItem, 'Done');
    expect(baseItem.dirty).toBe(false);
  });

  it('preserves other fields unchanged', () => {
    const result = markResolved(baseItem, 'Done');
    expect(result.source).toEqual(baseItem.source);
    expect(result.location).toEqual(baseItem.location);
    expect(result.comment).toBe(baseItem.comment);
    expect(result.analysis).toBe(baseItem.analysis);
    expect(result.recommendation).toBe(baseItem.recommendation);
    expect(result.options).toEqual(baseItem.options);
    expect(result.reportedBy).toEqual(baseItem.reportedBy);
  });

  it('allows empty string resolution (pins behavior)', () => {
    const result = markResolved(baseItem, '');
    expect(result.resolution).toBe('');
    expect(result.status).toBe('resolved');
  });
});

describe('markCustom', () => {
  it('returns a new object reference', () => {
    const result = markCustom(baseItem, 'Approved with edits');
    expect(result).not.toBe(baseItem);
  });

  it('sets status to custom', () => {
    const result = markCustom(baseItem, 'Approved with edits');
    expect(result.status).toBe('custom');
  });

  it('sets the resolution text', () => {
    const result = markCustom(baseItem, 'Approved with edits');
    expect(result.resolution).toBe('Approved with edits');
  });

  it('sets dirty: true', () => {
    const result = markCustom(baseItem, 'Approved with edits');
    expect(result.dirty).toBe(true);
  });

  it('does NOT mutate the original', () => {
    markCustom(baseItem, 'Approved with edits');
    expect(baseItem.status).toBe('unresolved');
    expect(baseItem.dirty).toBe(false);
  });

  it('preserves other fields unchanged', () => {
    const result = markCustom(baseItem, 'Approved with edits');
    expect(result.source).toEqual(baseItem.source);
    expect(result.location).toEqual(baseItem.location);
    expect(result.comment).toBe(baseItem.comment);
  });
});

describe('markDeferred', () => {
  it('returns a new object reference', () => {
    const result = markDeferred(baseItem);
    expect(result).not.toBe(baseItem);
  });

  it('sets status to deferred', () => {
    const result = markDeferred(baseItem);
    expect(result.status).toBe('deferred');
  });

  it('sets dirty: true', () => {
    const result = markDeferred(baseItem);
    expect(result.dirty).toBe(true);
  });

  it('does NOT mutate the original', () => {
    markDeferred(baseItem);
    expect(baseItem.status).toBe('unresolved');
    expect(baseItem.dirty).toBe(false);
  });

  it('preserves resolution unchanged', () => {
    const result = markDeferred(baseItem);
    expect(result.resolution).toBe(baseItem.resolution);
  });

  it('preserves other fields unchanged', () => {
    const result = markDeferred(baseItem);
    expect(result.source).toEqual(baseItem.source);
    expect(result.location).toEqual(baseItem.location);
    expect(result.comment).toBe(baseItem.comment);
  });
});

describe('markSkipped', () => {
  it('returns a new object reference', () => {
    const result = markSkipped(baseItem);
    expect(result).not.toBe(baseItem);
  });

  it('sets status to skipped', () => {
    const result = markSkipped(baseItem);
    expect(result.status).toBe('skipped');
  });

  it('sets dirty: true', () => {
    const result = markSkipped(baseItem);
    expect(result.dirty).toBe(true);
  });

  it('does NOT mutate the original', () => {
    markSkipped(baseItem);
    expect(baseItem.status).toBe('unresolved');
    expect(baseItem.dirty).toBe(false);
  });

  it('preserves resolution unchanged', () => {
    const result = markSkipped(baseItem);
    expect(result.resolution).toBe(baseItem.resolution);
  });

  it('preserves other fields unchanged', () => {
    const result = markSkipped(baseItem);
    expect(result.source).toEqual(baseItem.source);
    expect(result.location).toEqual(baseItem.location);
  });
});

describe('markUnresolved', () => {
  const resolvedItem: FindingItem = {
    ...baseItem,
    status: 'resolved',
    resolution: 'Previously resolved',
    dirty: true,
  };

  it('returns a new object reference', () => {
    const result = markUnresolved(resolvedItem);
    expect(result).not.toBe(resolvedItem);
  });

  it('sets status to unresolved', () => {
    const result = markUnresolved(resolvedItem);
    expect(result.status).toBe('unresolved');
  });

  it('sets dirty: true', () => {
    const result = markUnresolved(resolvedItem);
    expect(result.dirty).toBe(true);
  });

  it('does NOT mutate the original', () => {
    markUnresolved(resolvedItem);
    expect(resolvedItem.status).toBe('resolved');
  });

  it('preserves resolution (does not clear it)', () => {
    const result = markUnresolved(resolvedItem);
    expect(result.resolution).toBe('Previously resolved');
  });

  it('preserves other fields unchanged', () => {
    const result = markUnresolved(resolvedItem);
    expect(result.source).toEqual(resolvedItem.source);
    expect(result.location).toEqual(resolvedItem.location);
    expect(result.comment).toBe(resolvedItem.comment);
  });
});

describe('withResolution', () => {
  it('returns a new object reference', () => {
    const result = withResolution(baseItem, 'Fixed in next PR');
    expect(result).not.toBe(baseItem);
  });

  it('sets the resolution field', () => {
    const result = withResolution(baseItem, 'Fixed in next PR');
    expect(result.resolution).toBe('Fixed in next PR');
  });

  it('sets dirty: true on the new item', () => {
    const result = withResolution(baseItem, 'Fixed in next PR');
    expect(result.dirty).toBe(true);
  });

  it('does NOT mutate the original item resolution', () => {
    withResolution(baseItem, 'Fixed in next PR');
    expect(baseItem.resolution).toBe('');
  });

  it('does NOT mutate the original dirty flag', () => {
    withResolution(baseItem, 'Fixed in next PR');
    expect(baseItem.dirty).toBe(false);
  });

  it('preserves other fields unchanged', () => {
    const result = withResolution(baseItem, 'Done');
    expect(result.status).toBe(baseItem.status);
    expect(result.source).toEqual(baseItem.source);
    expect(result.location).toEqual(baseItem.location);
    expect(result.comment).toBe(baseItem.comment);
    expect(result.analysis).toBe(baseItem.analysis);
    expect(result.recommendation).toBe(baseItem.recommendation);
    expect(result.options).toEqual(baseItem.options);
  });

  it('does not change status', () => {
    const result = withResolution(baseItem, 'Some text');
    expect(result.status).toBe('unresolved');
  });
});

describe('chaining', () => {
  it('markResolved then markResolved — second resolution wins', () => {
    const result = markResolved(markResolved(baseItem, 'First'), 'Second');
    expect(result.status).toBe('resolved');
    expect(result.resolution).toBe('Second');
    expect(result.dirty).toBe(true);
  });

  it('markDeferred then markResolved', () => {
    const result = markResolved(markDeferred(baseItem), 'Now resolved');
    expect(result.status).toBe('resolved');
    expect(result.resolution).toBe('Now resolved');
    expect(result.dirty).toBe(true);
  });

  it('markResolved then markUnresolved — status reverts', () => {
    const result = markUnresolved(markResolved(baseItem, 'Done'));
    expect(result.status).toBe('unresolved');
    expect(result.dirty).toBe(true);
    // resolution from prior step is preserved
    expect(result.resolution).toBe('Done');
  });

  it('base item is never mutated through any chain', () => {
    markResolved(markDeferred(markSkipped(markUnresolved(markCustom(baseItem, 'x')))), 'y');
    expect(baseItem.status).toBe('unresolved');
    expect(baseItem.dirty).toBe(false);
  });
});
