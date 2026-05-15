import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createFindingsWriter } from './findings-writer';

const sha8 = (data: string): string =>
  createHash('sha256').update(data, 'utf8').digest('hex').slice(0, 8);

describe('createFindingsWriter', () => {
  it('writes, returns mtime + sha8, and stores last write sha per filePath', async () => {
    const writeFile = vi.fn(async () => undefined);
    const stat = vi.fn(async () => ({ mtimeMs: 4242 }));
    const writer = createFindingsWriter({ writeFile, stat });

    const payload = 'hello world';
    const result = await writer.write('/tmp/a.md', payload);

    expect(writeFile).toHaveBeenCalledWith('/tmp/a.md', payload);
    expect(stat).toHaveBeenCalledWith('/tmp/a.md');
    expect(result).toEqual({ mtime: 4242, sha: sha8(payload) });
    expect(writer.getLastWriteSha('/tmp/a.md')).toBe(sha8(payload));
  });

  it('uses sha256 hex truncated to 8 chars by default', async () => {
    const writer = createFindingsWriter({
      writeFile: async () => undefined,
      stat: async () => ({ mtimeMs: 0 }),
    });
    const { sha } = await writer.write('/tmp/a.md', 'abc');
    expect(sha).toBe(sha8('abc'));
    expect(sha).toHaveLength(8);
  });

  it('returns undefined from getLastWriteSha before any write', () => {
    const writer = createFindingsWriter({
      writeFile: async () => undefined,
      stat: async () => ({ mtimeMs: 0 }),
    });
    expect(writer.getLastWriteSha('/tmp/never.md')).toBeUndefined();
  });

  it('surfaces writeFile rejection and leaves stored sha unchanged', async () => {
    const writeFile = vi
      .fn<[string, string], Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disk full'));
    const stat = vi.fn(async () => ({ mtimeMs: 1 }));
    const writer = createFindingsWriter({ writeFile, stat });

    await writer.write('/tmp/a.md', 'first');
    const firstSha = writer.getLastWriteSha('/tmp/a.md');
    expect(firstSha).toBe(sha8('first'));

    await expect(writer.write('/tmp/a.md', 'second')).rejects.toThrowError('disk full');
    expect(writer.getLastWriteSha('/tmp/a.md')).toBe(firstSha);
  });

  it('isolates lastWriteSha per filePath', async () => {
    const writer = createFindingsWriter({
      writeFile: async () => undefined,
      stat: async () => ({ mtimeMs: 0 }),
    });
    await writer.write('/tmp/a.md', 'A');
    await writer.write('/tmp/b.md', 'B');
    expect(writer.getLastWriteSha('/tmp/a.md')).toBe(sha8('A'));
    expect(writer.getLastWriteSha('/tmp/b.md')).toBe(sha8('B'));
  });

  it('sets lastWriteSha synchronously before writeFile resolves so watcher self-write check cannot race', async () => {
    let resolveWrite: (() => void) | undefined;
    const writeFile = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    const stat = vi.fn(async () => ({ mtimeMs: 0 }));
    const writer = createFindingsWriter({ writeFile, stat });

    const pending = writer.write('/tmp/a.md', 'payload');
    expect(writer.getLastWriteSha('/tmp/a.md')).toBe(sha8('payload'));
    resolveWrite?.();
    await pending;
    expect(writer.getLastWriteSha('/tmp/a.md')).toBe(sha8('payload'));
  });

  it('allows injecting a custom sha256 implementation', async () => {
    const writer = createFindingsWriter({
      writeFile: async () => undefined,
      stat: async () => ({ mtimeMs: 0 }),
      sha256: () => 'deadbeef',
    });
    const { sha } = await writer.write('/tmp/a.md', 'irrelevant');
    expect(sha).toBe('deadbeef');
    expect(writer.getLastWriteSha('/tmp/a.md')).toBe('deadbeef');
  });
});
