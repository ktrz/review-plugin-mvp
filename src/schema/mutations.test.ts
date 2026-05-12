import { describe, it, expect } from 'vitest';
import { withStatus, withResolution } from './mutations';
import type { FindingItem } from './types';

// A minimal FindingItem fixture for mutation tests
const baseItem: FindingItem = {
  status: '[?]',
  source: { kind: 'auto-review' },
  file: 'src/foo.ts',
  line: 10,
  severity: 'critical',
  reportedBy: ['auto-review'],
  comment: 'Something is wrong.',
  analysis: 'Very wrong.',
  recommendation: 'Fix it.',
  options: ['Option A: Do X', 'Option B: Do Y'],
  resolution: '',
  rawSource: '## [?] auto:critical — src/foo.ts:10\n\n**Severity:** critical',
  dirty: false,
};

describe('withStatus', () => {
  it('returns a new object reference', () => {
    const result = withStatus(baseItem, '[x]');
    expect(result).not.toBe(baseItem);
  });

  it('sets the new status marker', () => {
    const result = withStatus(baseItem, '[x]');
    expect(result.status).toBe('[x]');
  });

  it('sets dirty: true on the new item', () => {
    const result = withStatus(baseItem, '[x]');
    expect(result.dirty).toBe(true);
  });

  it('does NOT mutate the original item status', () => {
    withStatus(baseItem, '[x]');
    expect(baseItem.status).toBe('[?]');
  });

  it('does NOT mutate the original dirty flag', () => {
    withStatus(baseItem, '[x]');
    expect(baseItem.dirty).toBe(false);
  });

  it('preserves other fields unchanged', () => {
    const result = withStatus(baseItem, '[~]');
    expect(result.source).toEqual(baseItem.source);
    expect(result.file).toBe(baseItem.file);
    expect(result.line).toBe(baseItem.line);
    expect(result.severity).toBe(baseItem.severity);
    expect(result.comment).toBe(baseItem.comment);
    expect(result.analysis).toBe(baseItem.analysis);
    expect(result.recommendation).toBe(baseItem.recommendation);
    expect(result.options).toEqual(baseItem.options);
    expect(result.resolution).toBe(baseItem.resolution);
    expect(result.rawSource).toBe(baseItem.rawSource);
  });

  it('optionally sets resolution when provided', () => {
    const result = withStatus(baseItem, '[x]', 'Fixed in next PR');
    expect(result.resolution).toBe('Fixed in next PR');
  });

  it('does not set resolution when not provided', () => {
    const result = withStatus(baseItem, '[x]');
    expect(result.resolution).toBe(baseItem.resolution);
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
    expect(result.file).toBe(baseItem.file);
    expect(result.line).toBe(baseItem.line);
    expect(result.severity).toBe(baseItem.severity);
    expect(result.comment).toBe(baseItem.comment);
  });
});
