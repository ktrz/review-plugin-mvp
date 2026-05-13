import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ChatMessageSchema, FindingItemSchema } from './types';

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

describe('ChatMessageSchema', () => {
  it('accepts a valid user message', () => {
    const result = ChatMessageSchema.safeParse({ role: 'user', content: 'hello' });
    expect(result.success).toBe(true);
  });

  it('accepts a valid assistant message', () => {
    const result = ChatMessageSchema.safeParse({ role: 'assistant', content: 'hi' });
    expect(result.success).toBe(true);
  });

  it('rejects unknown role with ZodError invalid_enum_value on path [role]', () => {
    const result = ChatMessageSchema.safeParse({ role: 'system', content: 'x' });
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('expected schema to reject role=system');
    }
    const roleIssues = result.error.issues.filter((iss) => iss.path.join('.') === 'role');
    expect(roleIssues).toHaveLength(1);
    expect(roleIssues[0].code).toBe(z.ZodIssueCode.invalid_enum_value);
  });

  it('rejects empty content with ZodError too_small on path [content]', () => {
    const result = ChatMessageSchema.safeParse({ role: 'user', content: '' });
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('expected schema to reject empty content');
    }
    const contentIssues = result.error.issues.filter((iss) => iss.path.join('.') === 'content');
    expect(contentIssues).toHaveLength(1);
    expect(contentIssues[0].code).toBe(z.ZodIssueCode.too_small);
  });

  it('rejects unknown extra keys due to strict()', () => {
    const result = ChatMessageSchema.safeParse({ role: 'user', content: 'hi', extra: 1 });
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('expected schema to reject extra keys');
    }
    expect(result.error.issues.some((iss) => iss.code === z.ZodIssueCode.unrecognized_keys)).toBe(true);
  });
});

describe('FindingItemSchema — chat field', () => {
  it('accepts absent chat (optional)', () => {
    const ok = FindingItemSchema.safeParse({ ...baseItem, id: 'a' });
    expect(ok.success).toBe(true);
  });

  it('accepts empty chat array', () => {
    const ok = FindingItemSchema.safeParse({ ...baseItem, id: 'a', chat: [] });
    expect(ok.success).toBe(true);
  });

  it('accepts a multi-message chat array', () => {
    const ok = FindingItemSchema.safeParse({
      ...baseItem,
      id: 'a',
      chat: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it('rejects a chat array containing an invalid role', () => {
    const result = FindingItemSchema.safeParse({
      ...baseItem,
      id: 'a',
      chat: [{ role: 'bogus', content: 'hi' }],
    });
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('expected schema to reject invalid chat role');
    }
    const roleIssues = result.error.issues.filter((iss) =>
      iss.path.join('.') === 'chat.0.role',
    );
    expect(roleIssues).toHaveLength(1);
    expect(roleIssues[0].code).toBe(z.ZodIssueCode.invalid_enum_value);
  });
});
