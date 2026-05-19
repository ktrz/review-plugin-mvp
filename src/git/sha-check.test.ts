import { describe, expect, it } from 'vitest';
import { checkHeadSha, shortSha } from './sha-check';

const SHA_DOC = 'aaaa'.repeat(10);
const SHA_HEAD = 'bbbb'.repeat(10);

const makeGetHeadSha = (sha: string | null) =>
  async (_cwd: string, _run: unknown) => sha;

const makeObjectExists = (exists: boolean) =>
  async (_sha: string, _cwd: string, _run: unknown) => exists;

describe('checkHeadSha', () => {
  it('doc SHA missing → unknown/doc-missing-sha', async () => {
    const result = await checkHeadSha({
      workspaceRoot: '/repo',
      docHeadSha: undefined,
    });
    expect(result).toEqual({ kind: 'unknown', reason: 'doc-missing-sha' });
  });

  it('workspace not a repo → unknown/workspace-not-repo', async () => {
    const result = await checkHeadSha({
      workspaceRoot: '/not-a-repo',
      docHeadSha: SHA_DOC,
      getHeadSha: makeGetHeadSha(null) as typeof import('./head-sha').getHeadSha,
      objectExists: makeObjectExists(false) as typeof import('./head-sha').objectExists,
    });
    expect(result).toEqual({ kind: 'unknown', reason: 'workspace-not-repo' });
  });

  it('SHAs equal → match', async () => {
    const result = await checkHeadSha({
      workspaceRoot: '/repo',
      docHeadSha: SHA_DOC,
      getHeadSha: makeGetHeadSha(SHA_DOC) as typeof import('./head-sha').getHeadSha,
      objectExists: makeObjectExists(false) as typeof import('./head-sha').objectExists,
    });
    expect(result).toEqual({ kind: 'match', sha: SHA_DOC });
  });

  it('SHAs differ + doc-sha reachable → mismatch', async () => {
    const result = await checkHeadSha({
      workspaceRoot: '/repo',
      docHeadSha: SHA_DOC,
      getHeadSha: makeGetHeadSha(SHA_HEAD) as typeof import('./head-sha').getHeadSha,
      objectExists: makeObjectExists(true) as typeof import('./head-sha').objectExists,
    });
    expect(result).toEqual({ kind: 'mismatch', docSha: SHA_DOC, headSha: SHA_HEAD });
  });

  it('SHAs differ + doc-sha unreachable → unreachable', async () => {
    const result = await checkHeadSha({
      workspaceRoot: '/repo',
      docHeadSha: SHA_DOC,
      getHeadSha: makeGetHeadSha(SHA_HEAD) as typeof import('./head-sha').getHeadSha,
      objectExists: makeObjectExists(false) as typeof import('./head-sha').objectExists,
    });
    expect(result).toEqual({ kind: 'unreachable', docSha: SHA_DOC, headSha: SHA_HEAD });
  });
});

describe('shortSha', () => {
  it('returns first 8 chars', () => {
    expect(shortSha('abcdef1234567890')).toBe('abcdef12');
  });
});
