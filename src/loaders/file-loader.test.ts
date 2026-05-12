import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ParseError } from '../schema';
import { loadFindingsFile } from './file-loader';

const FIXTURE_PATH = path.resolve(__dirname, '..', '..', 'fixtures', 'pr-42-auto-review.md');

type ReadFileFn = (filePath: string, encoding: 'utf8') => Promise<string>;
type StatFn = (filePath: string) => Promise<{ mtimeMs: number }>;

describe('loadFindingsFile', () => {
  it('loads the real fixture and returns parsed doc plus mtime', async () => {
    const result = await loadFindingsFile(FIXTURE_PATH);

    expect(result.mtime).toBeGreaterThan(0);
    expect(result.doc.header.prNumber).toBe(42);
    expect(result.doc.items.length).toBeGreaterThan(0);
  });

  it('uses injected stat for mtime and injected readFile for raw contents', async () => {
    const raw = fs.readFileSync(FIXTURE_PATH, 'utf8');
    const fakeMtime = 1_700_000_000_123;
    const stat: StatFn = vi.fn(async () => ({ mtimeMs: fakeMtime }));
    const readFile: ReadFileFn = vi.fn(async () => raw);

    const result = await loadFindingsFile('/virtual/findings.md', { stat, readFile });

    expect(result.mtime).toBe(fakeMtime);
    expect(result.doc.header.prNumber).toBe(42);
    expect(stat).toHaveBeenCalledWith('/virtual/findings.md');
    expect(readFile).toHaveBeenCalledWith('/virtual/findings.md', 'utf8');
  });

  it('calls stat before readFile so a missing file fails fast', async () => {
    const callOrder: string[] = [];
    const stat: StatFn = vi.fn(async () => {
      callOrder.push('stat');
      const err = Object.assign(new Error('ENOENT: missing'), { code: 'ENOENT' });
      throw err;
    });
    const readFile: ReadFileFn = vi.fn(async () => {
      callOrder.push('readFile');
      return '';
    });

    await expect(
      loadFindingsFile('/missing/findings.md', { stat, readFile }),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    expect(callOrder).toEqual(['stat']);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('propagates readFile errors untouched', async () => {
    const stat: StatFn = vi.fn(async () => ({ mtimeMs: 1 }));
    const ioError = Object.assign(new Error('EACCES: denied'), { code: 'EACCES' });
    const readFile: ReadFileFn = vi.fn(async () => {
      throw ioError;
    });

    await expect(
      loadFindingsFile('/forbidden/findings.md', { stat, readFile }),
    ).rejects.toBe(ioError);
  });

  it('propagates ParseError with exact properties for malformed input', async () => {
    const stat: StatFn = vi.fn(async () => ({ mtimeMs: 42 }));
    const readFile: ReadFileFn = vi.fn(async () => '# title only');

    let caught: unknown = null;
    try {
      await loadFindingsFile('/virtual/bad.md', { stat, readFile });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ParseError);
    expect(caught).toEqual(
      expect.objectContaining({ state: 'IN_HEADER', lineNumber: expect.any(Number) }),
    );
  });

  it('treats empty file contents as a ParseError from the schema layer', async () => {
    const stat: StatFn = vi.fn(async () => ({ mtimeMs: 7 }));
    const readFile: ReadFileFn = vi.fn(async () => '');

    await expect(
      loadFindingsFile('/virtual/empty.md', { stat, readFile }),
    ).rejects.toBeInstanceOf(ParseError);
  });
});
