import { describe, expect, it, vi } from 'vitest';
import { createHunkLoader, HunkLoaderError } from './hunk-loader';

function makeFile(lines: string[]): string {
  return lines.join('\n');
}

function smallFile(): string {
  const lines: string[] = [];
  for (let i = 1; i <= 50; i++) {
    lines.push(`line ${i}`);
  }
  return makeFile(lines);
}

function largeFileWithBoundary(): string {
  const lines: string[] = [];
  for (let i = 1; i <= 400; i++) {
    if (i === 55) {
      lines.push('function target() {');
    } else if (i === 100) {
      lines.push('  const inner = 1;');
    } else {
      lines.push(`  body ${i}`);
    }
  }
  return makeFile(lines);
}

function largeFileNoBoundary(): string {
  const lines: string[] = [];
  for (let i = 1; i <= 400; i++) {
    lines.push(`  indented ${i}`);
  }
  return makeFile(lines);
}

describe('createHunkLoader', () => {
  it('returns whole file with startLine=1 when file has <= 200 lines', async () => {
    const content = smallFile();
    const readFile = vi.fn().mockResolvedValue(content);
    const loader = createHunkLoader({ readFile });

    const result = await loader.load('/repo/src/foo.ts', 25);

    expect(result.startLine).toBe(1);
    expect(result.hunk).toBe(content);
    expect(result.lang).toBe('typescript');
    expect(readFile).toHaveBeenCalledWith('/repo/src/foo.ts');
  });

  it('slices [line-30, line+30] when file > 200 lines and expands upward to function boundary within 20-line cap', async () => {
    const content = largeFileWithBoundary();
    const readFile = vi.fn().mockResolvedValue(content);
    const loader = createHunkLoader({ readFile });

    const result = await loader.load('/repo/src/foo.ts', 100);

    expect(result.startLine).toBe(55);
    const hunkLines = result.hunk.split('\n');
    expect(hunkLines[0]).toBe('function target() {');
    expect(hunkLines[hunkLines.length - 1]).toBe('  body 130');
    expect(result.lang).toBe('typescript');
  });

  it('caps upward expansion at 20 lines when no boundary found', async () => {
    const content = largeFileNoBoundary();
    const readFile = vi.fn().mockResolvedValue(content);
    const loader = createHunkLoader({ readFile });

    const result = await loader.load('/repo/src/foo.ts', 100);

    expect(result.startLine).toBe(50);
    const hunkLines = result.hunk.split('\n');
    expect(hunkLines).toHaveLength(81);
    expect(hunkLines[0]).toBe('  indented 50');
    expect(hunkLines[hunkLines.length - 1]).toBe('  indented 130');
  });

  it('clamps start to 1 when line - 30 falls below 1', async () => {
    const lines: string[] = [];
    for (let i = 1; i <= 400; i++) {
      lines.push(`  pad ${i}`);
    }
    const readFile = vi.fn().mockResolvedValue(makeFile(lines));
    const loader = createHunkLoader({ readFile });

    const result = await loader.load('/repo/src/foo.ts', 5);

    expect(result.startLine).toBe(1);
  });

  it('clamps end to last line when line + 30 exceeds file length', async () => {
    const lines: string[] = [];
    for (let i = 1; i <= 250; i++) {
      lines.push(`  pad ${i}`);
    }
    const readFile = vi.fn().mockResolvedValue(makeFile(lines));
    const loader = createHunkLoader({ readFile });

    const result = await loader.load('/repo/src/foo.ts', 245);

    const hunkLines = result.hunk.split('\n');
    expect(hunkLines[hunkLines.length - 1]).toBe('  pad 250');
  });

  it('infers lang ts -> typescript', async () => {
    const readFile = vi.fn().mockResolvedValue('a');
    const loader = createHunkLoader({ readFile });
    const result = await loader.load('/repo/x.ts', 1);
    expect(result.lang).toBe('typescript');
  });

  it('infers lang tsx -> tsx', async () => {
    const readFile = vi.fn().mockResolvedValue('a');
    const loader = createHunkLoader({ readFile });
    const result = await loader.load('/repo/x.tsx', 1);
    expect(result.lang).toBe('tsx');
  });

  it('infers lang js -> javascript', async () => {
    const readFile = vi.fn().mockResolvedValue('a');
    const loader = createHunkLoader({ readFile });
    const result = await loader.load('/repo/x.js', 1);
    expect(result.lang).toBe('javascript');
  });

  it('infers lang py -> python', async () => {
    const readFile = vi.fn().mockResolvedValue('a');
    const loader = createHunkLoader({ readFile });
    const result = await loader.load('/repo/x.py', 1);
    expect(result.lang).toBe('python');
  });

  it('infers lang go -> go', async () => {
    const readFile = vi.fn().mockResolvedValue('a');
    const loader = createHunkLoader({ readFile });
    const result = await loader.load('/repo/x.go', 1);
    expect(result.lang).toBe('go');
  });

  it('falls back to text for unknown extension', async () => {
    const readFile = vi.fn().mockResolvedValue('a');
    const loader = createHunkLoader({ readFile });
    const result = await loader.load('/repo/x.weird', 1);
    expect(result.lang).toBe('text');
  });

  it('falls back to text when no extension', async () => {
    const readFile = vi.fn().mockResolvedValue('a');
    const loader = createHunkLoader({ readFile });
    const result = await loader.load('/repo/Makefile', 1);
    expect(result.lang).toBe('text');
  });

  it('rejects with HunkLoaderError when readFile fails', async () => {
    const readFile = vi.fn().mockRejectedValue(new Error('disk gone'));
    const loader = createHunkLoader({ readFile });

    try {
      await loader.load('/repo/x.ts', 1);
      throw new Error('expected reject');
    } catch (e) {
      expect(e).toBeInstanceOf(HunkLoaderError);
      const he = e as HunkLoaderError;
      expect(he.filePath).toBe('/repo/x.ts');
      expect(he.cause).toBeInstanceOf(Error);
    }
  });

  it('rejects with HunkLoaderError when line is out of range (line > file length)', async () => {
    const readFile = vi.fn().mockResolvedValue(smallFile());
    const loader = createHunkLoader({ readFile });

    try {
      await loader.load('/repo/x.ts', 9999);
      throw new Error('expected reject');
    } catch (e) {
      expect(e).toBeInstanceOf(HunkLoaderError);
      const he = e as HunkLoaderError;
      expect(he.message).toMatch(/out of range/i);
    }
  });

  it('rejects with HunkLoaderError when line < 1', async () => {
    const readFile = vi.fn().mockResolvedValue(smallFile());
    const loader = createHunkLoader({ readFile });

    try {
      await loader.load('/repo/x.ts', 0);
      throw new Error('expected reject');
    } catch (e) {
      expect(e).toBeInstanceOf(HunkLoaderError);
    }
  });
});
