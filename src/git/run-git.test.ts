import { describe, expect, it } from 'vitest';
import type { GitRunner } from './run-git';

describe('GitRunner contract', () => {
  it('success: returns { stdout, stderr }', async () => {
    const run: GitRunner = async (_args, _opts) => ({
      stdout: 'abc123\n',
      stderr: '',
    });
    const result = await run(['rev-parse', 'HEAD'], { cwd: '/repo' });
    expect(result.stdout).toBe('abc123\n');
    expect(result.stderr).toBe('');
  });

  it('non-zero exit: throws (callers catch)', async () => {
    const run: GitRunner = async () => {
      const err = Object.assign(new Error('not a git repo'), { code: 128 });
      throw err;
    };
    await expect(run(['rev-parse', 'HEAD'], { cwd: '/not-a-repo' })).rejects.toThrow(
      'not a git repo',
    );
  });

  it('ENOENT: throws (callers catch)', async () => {
    const run: GitRunner = async () => {
      const err = Object.assign(new Error('git not found'), { code: 'ENOENT' });
      throw err;
    };
    await expect(run(['rev-parse', 'HEAD'], { cwd: '/repo' })).rejects.toThrow(
      'git not found',
    );
  });
});
