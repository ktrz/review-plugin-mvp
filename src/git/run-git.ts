import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export type GitRunner = (
  args: string[],
  opts: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

export const runGit: GitRunner = async (args, opts) => {
  return execFileP('git', args, { cwd: opts.cwd, encoding: 'utf8' }) as Promise<{
    stdout: string;
    stderr: string;
  }>;
};
