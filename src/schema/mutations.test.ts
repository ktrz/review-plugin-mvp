import { describe, it, expect } from 'vitest';
import {
  markResolved,
  markCustom,
  markDeferred,
  markSkipped,
  markUnresolved,
  withResolution,
  appendChat,
  UnknownIdError,
} from './mutations';
import type { ChatMessage, FindingItem, HandoverDocument } from './types';
import { DocumentHeaderSchema } from './types';

const baseItem: FindingItem = {
  id: 'item-1',
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

describe.each([
  { name: 'markResolved', fn: (i: FindingItem) => markResolved(i, 'x'), status: 'resolved' as const },
  { name: 'markCustom',   fn: (i: FindingItem) => markCustom(i, 'x'),   status: 'custom'   as const },
  { name: 'markDeferred', fn: markDeferred,                              status: 'deferred' as const },
  { name: 'markSkipped',  fn: markSkipped,                               status: 'skipped'  as const },
  { name: 'markUnresolved', fn: markUnresolved,                          status: 'unresolved' as const },
])('$name — shared assertions', ({ fn, status }) => {
  const result = fn(baseItem);

  it('returns a new object reference', () => {
    expect(result).not.toBe(baseItem);
  });

  it('sets status', () => {
    expect(result.status).toBe(status);
  });

  it('sets dirty: true', () => {
    expect(result.dirty).toBe(true);
  });

  it('does not mutate original status', () => {
    expect(baseItem.status).toBe('unresolved');
  });

  it('does not mutate original dirty', () => {
    expect(baseItem.dirty).toBe(false);
  });

  it('options is a new array reference', () => {
    expect(result.options).not.toBe(baseItem.options);
  });

  it('reportedBy is a new array reference', () => {
    expect(result.reportedBy).not.toBe(baseItem.reportedBy);
  });

  it('preserves rawSource', () => {
    expect(result.rawSource).toBe(baseItem.rawSource);
  });

  it('preserves other fields deep-equal', () => {
    expect(result.source).toEqual(baseItem.source);
    expect(result.location).toEqual(baseItem.location);
    expect(result.comment).toBe(baseItem.comment);
    expect(result.analysis).toBe(baseItem.analysis);
    expect(result.recommendation).toBe(baseItem.recommendation);
    expect(result.options).toEqual(baseItem.options);
    expect(result.reportedBy).toEqual(baseItem.reportedBy);
  });
});

describe('markResolved', () => {
  it('sets the resolution text', () => {
    const result = markResolved(baseItem, 'Fixed in PR #99');
    expect(result.resolution).toBe('Fixed in PR #99');
  });

  it('allows empty string resolution (pins behavior)', () => {
    const result = markResolved(baseItem, '');
    expect(result.resolution).toBe('');
    expect(result.status).toBe('resolved');
  });
});

describe('markCustom', () => {
  it('sets the resolution text', () => {
    const result = markCustom(baseItem, 'Approved with edits');
    expect(result.resolution).toBe('Approved with edits');
  });
});

describe('markUnresolved', () => {
  const resolvedItem: FindingItem = {
    ...baseItem,
    status: 'resolved',
    resolution: 'Previously resolved',
    dirty: true,
  };

  it('preserves resolution (does not clear it)', () => {
    const result = markUnresolved(resolvedItem);
    expect(result.resolution).toBe('Previously resolved');
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

  it('does not change status', () => {
    const result = withResolution(baseItem, 'Some text');
    expect(result.status).toBe('unresolved');
  });

  it('options is a new array reference', () => {
    const result = withResolution(baseItem, 'Done');
    expect(result.options).not.toBe(baseItem.options);
  });

  it('reportedBy is a new array reference', () => {
    const result = withResolution(baseItem, 'Done');
    expect(result.reportedBy).not.toBe(baseItem.reportedBy);
  });

  it('preserves rawSource', () => {
    const result = withResolution(baseItem, 'Done');
    expect(result.rawSource).toBe(baseItem.rawSource);
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
});

describe('chat preservation across mutations', () => {
  const itemWithChat: FindingItem = {
    ...baseItem,
    chat: [
      { role: 'user', content: 'why?' },
      { role: 'assistant', content: 'because.' },
    ],
  };

  it('markResolved preserves chat verbatim', () => {
    const result = markResolved(itemWithChat, 'Done');
    expect(result.chat).toEqual(itemWithChat.chat);
  });

  it('markCustom preserves chat verbatim', () => {
    const result = markCustom(itemWithChat, 'Edited');
    expect(result.chat).toEqual(itemWithChat.chat);
  });

  it('markDeferred preserves chat verbatim', () => {
    const result = markDeferred(itemWithChat);
    expect(result.chat).toEqual(itemWithChat.chat);
  });

  it('markSkipped preserves chat verbatim', () => {
    const result = markSkipped(itemWithChat);
    expect(result.chat).toEqual(itemWithChat.chat);
  });

  it('markUnresolved preserves chat verbatim', () => {
    const result = markUnresolved(itemWithChat);
    expect(result.chat).toEqual(itemWithChat.chat);
  });

  it('markCustom does not mutate the original chat array reference', () => {
    const before = itemWithChat.chat;
    markCustom(itemWithChat, 'Edited');
    expect(itemWithChat.chat).toBe(before);
  });
});

describe('appendChat', () => {
  const header: HandoverDocument['header'] = DocumentHeaderSchema.parse({
    prUrl: 'https://github.com/example/repo/pull/1',
    prNumber: 1,
    branch: { head: { ref: 'feat/x' }, base: { ref: 'main' } },
    generatedAt: '2024-01-01T00:00:00Z',
    status: 'PENDING REVIEW',
  });

  function makeDoc(items: FindingItem[]): HandoverDocument {
    return { header, items };
  }

  it('creates an empty array, appends one message when chat is absent', () => {
    const doc = makeDoc([baseItem]);
    const msg: ChatMessage = { role: 'user', content: 'hi' };
    const next = appendChat(doc, 'item-1', msg);
    expect(next.items[0].chat).toEqual([msg]);
  });

  it('appends to an existing chat array', () => {
    const doc = makeDoc([
      { ...baseItem, chat: [{ role: 'user', content: 'first' }] },
    ]);
    const next = appendChat(doc, 'item-1', { role: 'assistant', content: 'reply' });
    expect(next.items[0].chat).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
    ]);
  });

  it('sets dirty: true on the mutated item', () => {
    const doc = makeDoc([baseItem]);
    const next = appendChat(doc, 'item-1', { role: 'user', content: 'hi' });
    expect(next.items[0].dirty).toBe(true);
  });

  it('returns a new doc reference, new items array, new item reference', () => {
    const doc = makeDoc([baseItem]);
    const next = appendChat(doc, 'item-1', { role: 'user', content: 'hi' });
    expect(next).not.toBe(doc);
    expect(next.items).not.toBe(doc.items);
    expect(next.items[0]).not.toBe(doc.items[0]);
  });

  it('does not mutate the original doc or item', () => {
    const doc = makeDoc([baseItem]);
    appendChat(doc, 'item-1', { role: 'user', content: 'hi' });
    expect(baseItem.chat).toBeUndefined();
    expect(doc.items[0].chat).toBeUndefined();
  });

  it('throws UnknownIdError for a non-existent id', () => {
    const doc = makeDoc([baseItem]);
    try {
      appendChat(doc, 'no-such-id', { role: 'user', content: 'hi' });
      throw new Error('expected appendChat to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(UnknownIdError);
      if (e instanceof UnknownIdError) {
        expect(e.findingId).toBe('no-such-id');
      }
    }
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
    expect(result.resolution).toBe('Done');
  });

  it('base item is never mutated through any chain', () => {
    markResolved(markDeferred(markSkipped(markUnresolved(markCustom(baseItem, 'x')))), 'y');
    expect(baseItem.status).toBe('unresolved');
    expect(baseItem.dirty).toBe(false);
  });
});
