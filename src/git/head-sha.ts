import type { GitRunner } from './run-git';

export async function getHeadSha(
  cwd: string,
  run: GitRunner,
): Promise<string | null> {
  try {
    const { stdout } = await run(['rev-parse', 'HEAD'], { cwd });
    const sha = stdout.trim();
    return /^[a-f0-9]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

export async function objectExists(
  sha: string,
  cwd: string,
  run: GitRunner,
): Promise<boolean> {
  try {
    await run(['cat-file', '-e', sha], { cwd });
    return true;
  } catch {
    return false;
  }
}
