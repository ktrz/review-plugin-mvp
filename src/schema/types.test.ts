import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { FindingItemSchema } from './types';

const baseItem = {
  status: 'unresolved' as const,
  source: { kind: 'auto-review' as const, severity: 'critical' as const },
  location: { kind: 'file' as const, file: 'src/foo.ts', line: 10 },
  reportedBy: ['auto-review'],
  comment: 'Comment text.',
  analysis: 'Analysis text.',
  recommendation: 'Recommendation text.',
  options: ['Option A'],
  resolution: '',
  rawSource: '## [?] auto:critical — src/foo.ts:10',
  dirty: false as const,
};

describe('FindingItemSchema — id field', () => {
  it('accepts a non-empty id', () => {
    const ok = FindingItemSchema.safeParse({ ...baseItem, id: 'abc-123' });
    expect(ok.success).toBe(true);
  });

  it('rejects empty id with a ZodError carrying the expected issue path and code', () => {
    const result = FindingItemSchema.safeParse({ ...baseItem, id: '' });
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('expected schema to reject empty id');
    }
    expect(result.error).toBeInstanceOf(z.ZodError);
    const idIssues = result.error.issues.filter((iss) => iss.path.join('.') === 'id');
    expect(idIssues).toHaveLength(1);
    const issue = idIssues[0];
    expect(issue.code).toBe(z.ZodIssueCode.too_small);
    if (issue.code === z.ZodIssueCode.too_small) {
      expect(issue.minimum).toBe(1);
      expect(issue.type).toBe('string');
      expect(issue.inclusive).toBe(true);
    }
  });

  it('rejects missing id with an invalid_type ZodError on path [id]', () => {
    const { ...withoutId } = baseItem;
    const result = FindingItemSchema.safeParse(withoutId);
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('expected schema to reject missing id');
    }
    const idIssues = result.error.issues.filter((iss) => iss.path.join('.') === 'id');
    expect(idIssues).toHaveLength(1);
    expect(idIssues[0].code).toBe(z.ZodIssueCode.invalid_type);
  });
});
