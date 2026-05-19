import { describe, expect, it } from 'vitest';
import { getHeadSha, objectExists } from './head-sha';
import type { GitRunner } from './run-git';

const SHA40 = 'a'.repeat(40);

describe('getHeadSha', () => {
  it('returns 40-char hex on success', async () => {
    const run: GitRunner = async () => ({ stdout: `${SHA40}\n`, stderr: '' });
    expect(await getHeadSha('/repo', run)).toBe(SHA40);
  });

  it('returns null on rev-parse failure (non-repo)', async () => {
    const run: GitRunner = async () => {
      throw new Error('not a git repo');
    };
    expect(await getHeadSha('/not-a-repo', run)).toBeNull();
  });

  it('returns null on ENOENT (git missing)', async () => {
    const run: GitRunner = async () => {
      const err = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
      throw err;
    };
    expect(await getHeadSha('/repo', run)).toBeNull();
  });

  it('returns null on malformed stdout (not 40 hex chars)', async () => {
    const run: GitRunner = async () => ({ stdout: 'HEAD\n', stderr: '' });
    expect(await getHeadSha('/repo', run)).toBeNull();
  });

  it('returns null on short sha (7 chars)', async () => {
    const run: GitRunner = async () => ({ stdout: 'abc1234\n', stderr: '' });
    expect(await getHeadSha('/repo', run)).toBeNull();
  });
});

describe('objectExists', () => {
  it('returns true when cat-file succeeds', async () => {
    const run: GitRunner = async () => ({ stdout: '', stderr: '' });
    expect(await objectExists(SHA40, '/repo', run)).toBe(true);
  });

  it('returns false on non-zero exit (object missing)', async () => {
    const run: GitRunner = async () => {
      throw Object.assign(new Error(''), { code: 1 });
    };
    expect(await objectExists(SHA40, '/repo', run)).toBe(false);
  });
});
