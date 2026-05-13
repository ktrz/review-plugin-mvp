import { describe, it, expect } from 'vitest';
import { parseDocument } from './parse';
import { serializeDocument } from './serialize';
import { markResolved } from './mutations';
import { DocumentHeaderSchema, type FindingItem, type HandoverDocument } from './types';

const header: HandoverDocument['header'] = DocumentHeaderSchema.parse({
  prUrl: 'https://github.com/example/repo/pull/1',
  prNumber: 1,
  branch: {
    head: { ref: 'feat/x' },
    base: { ref: 'main' },
  },
  generatedAt: '2024-01-01T00:00:00Z',
  status: 'PENDING REVIEW',
});

function dirtyItem(opts: { id: string }): FindingItem {
  return {
    id: opts.id,
    status: 'unresolved',
    source: { kind: 'auto-review', severity: 'critical' },
    location: { kind: 'file', file: 'src/foo.ts', line: 10 },
    reportedBy: ['auto-review'],
    comment: 'Comment text.',
    analysis: 'Analysis text.',
    recommendation: 'Recommendation text.',
    options: ['Option A'],
    resolution: '',
    dirty: true,
  } satisfies FindingItem;
}

describe('serializeDocument — Id field rendering', () => {
  it('renders **Id:** <value> for a dirty item with a non-empty id', () => {
    const doc: HandoverDocument = {
      header,
      items: [dirtyItem({ id: 'uuid-abc' })],
    };
    const out = serializeDocument(doc);
    expect(out).toContain('**Id:** uuid-abc');
  });

  it('places the Id line between **Reported by:** and **Comment:**', () => {
    const doc: HandoverDocument = {
      header,
      items: [dirtyItem({ id: 'uuid-position' })],
    };
    const out = serializeDocument(doc);
    const reportedIdx = out.indexOf('**Reported by:**');
    const idIdx = out.indexOf('**Id:**');
    const commentIdx = out.indexOf('**Comment:**');
    expect(reportedIdx).toBeGreaterThanOrEqual(0);
    expect(idIdx).toBeGreaterThan(reportedIdx);
    expect(commentIdx).toBeGreaterThan(idIdx);
  });

  it('always emits the **Id:** line — id is non-empty by schema invariant (stamper runs before serializer)', () => {
    const doc: HandoverDocument = {
      header,
      items: [dirtyItem({ id: 'uuid-123' })],
    };
    const out = serializeDocument(doc);
    expect(out).toContain('**Id:** uuid-123');
  });
});

describe('serializeDocument — Chat block', () => {
  it('omits **Chat:** block when chat is undefined', () => {
    const doc: HandoverDocument = {
      header,
      items: [dirtyItem({ id: 'no-chat' })],
    };
    const out = serializeDocument(doc);
    expect(out).not.toContain('**Chat:**');
  });

  it('omits **Chat:** block when chat is an empty array', () => {
    const item = { ...dirtyItem({ id: 'empty-chat' }), chat: [] } satisfies FindingItem;
    const doc: HandoverDocument = { header, items: [item] };
    const out = serializeDocument(doc);
    expect(out).not.toContain('**Chat:**');
  });

  it('renders a single user message', () => {
    const item = {
      ...dirtyItem({ id: 'one-msg' }),
      chat: [{ role: 'user', content: 'hello' }],
    } satisfies FindingItem;
    const doc: HandoverDocument = { header, items: [item] };
    const out = serializeDocument(doc);
    expect(out).toContain('**Chat:**\n- user: hello');
  });

  it('renders alternating user/assistant messages in order', () => {
    const item = {
      ...dirtyItem({ id: 'multi-msg' }),
      chat: [
        { role: 'user', content: 'ping' },
        { role: 'assistant', content: 'pong' },
      ],
    } satisfies FindingItem;
    const doc: HandoverDocument = { header, items: [item] };
    const out = serializeDocument(doc);
    expect(out).toContain('**Chat:**\n- user: ping\n- assistant: pong');
  });

  it('renders multi-line content via two-space continuation', () => {
    const item = {
      ...dirtyItem({ id: 'multiline-msg' }),
      chat: [
        { role: 'user', content: 'line one\nline two\nline three' },
      ],
    } satisfies FindingItem;
    const doc: HandoverDocument = { header, items: [item] };
    const out = serializeDocument(doc);
    expect(out).toContain('**Chat:**\n- user: line one\n  line two\n  line three');
  });

  it('places **Chat:** between **Options:** and **Resolution:**', () => {
    const item = {
      ...dirtyItem({ id: 'position-chat' }),
      chat: [{ role: 'user', content: 'x' }],
    } satisfies FindingItem;
    const doc: HandoverDocument = { header, items: [item] };
    const out = serializeDocument(doc);
    const optionsIdx = out.indexOf('**Options:**');
    const chatIdx = out.indexOf('**Chat:**');
    const resolutionIdx = out.indexOf('**Resolution:**');
    expect(optionsIdx).toBeGreaterThanOrEqual(0);
    expect(chatIdx).toBeGreaterThan(optionsIdx);
    expect(resolutionIdx).toBeGreaterThan(chatIdx);
  });

  it('round-trips multi-message chat through parse → serialize → parse', () => {
    const item = {
      ...dirtyItem({ id: 'rt-multi' }),
      chat: [
        { role: 'user', content: 'one' },
        { role: 'assistant', content: 'two' },
        { role: 'user', content: 'three' },
      ],
    } satisfies FindingItem;
    const doc: HandoverDocument = { header, items: [item] };
    const out = serializeDocument(doc);
    const reparsed = parseDocument(out);
    expect(reparsed.items[0].chat).toEqual([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'three' },
    ]);
  });

  it('round-trips multi-line content through parse → serialize → parse', () => {
    const item = {
      ...dirtyItem({ id: 'rt-multiline' }),
      chat: [
        { role: 'user', content: 'line one\nline two' },
        { role: 'assistant', content: 'ack' },
      ],
    } satisfies FindingItem;
    const doc: HandoverDocument = { header, items: [item] };
    const out = serializeDocument(doc);
    const reparsed = parseDocument(out);
    expect(reparsed.items[0].chat).toEqual([
      { role: 'user', content: 'line one\nline two' },
      { role: 'assistant', content: 'ack' },
    ]);
  });
});

describe('serializeDocument — round-trips a stamped item', () => {
  it('parse(serialize({ id: "abc" })) preserves the id verbatim', () => {
    const doc: HandoverDocument = {
      header,
      items: [dirtyItem({ id: 'preserved-id' })],
    };
    const serialized = serializeDocument(doc);
    const reparsed = parseDocument(serialized);
    expect(reparsed.items).toHaveLength(1);
    expect(reparsed.items[0].id).toBe('preserved-id');
  });

  it('mutating an item via markResolved keeps the id through re-render', () => {
    const item = dirtyItem({ id: 'stable-id' });
    const resolved = markResolved(item, 'Done');
    const doc: HandoverDocument = { header, items: [resolved] };
    const serialized = serializeDocument(doc);
    expect(serialized).toContain('**Id:** stable-id');
    const reparsed = parseDocument(serialized);
    expect(reparsed.items[0].id).toBe('stable-id');
    expect(reparsed.items[0].status).toBe('resolved');
    expect(reparsed.items[0].resolution).toBe('Done');
  });
});
