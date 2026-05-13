import { describe, expect, it } from 'vitest';
import { resolveHunkPath } from './resolve-hunk-path';

describe('resolveHunkPath', () => {
  it('joins a relative path onto the workspace root', () => {
    expect(resolveHunkPath('src/api-client.ts', '/repo')).toBe('/repo/src/api-client.ts');
  });

  it('returns an absolute path unchanged', () => {
    expect(resolveHunkPath('/abs/src/api-client.ts', '/repo')).toBe('/abs/src/api-client.ts');
  });

  it('collapses ./ and ../ segments in the relative path', () => {
    expect(resolveHunkPath('./src/./a.ts', '/repo')).toBe('/repo/src/a.ts');
    expect(resolveHunkPath('src/../lib/b.ts', '/repo')).toBe('/repo/lib/b.ts');
  });

  it('treats a relative workspace root as relative to cwd (still produces an absolute path)', () => {
    const result = resolveHunkPath('src/a.ts', 'relative-root');
    expect(result.endsWith('/relative-root/src/a.ts')).toBe(true);
    expect(result.startsWith('/')).toBe(true);
  });
});
