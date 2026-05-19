import { runGit } from './run-git';
import type { GitRunner } from './run-git';
import { getHeadSha, objectExists } from './head-sha';

export type ShaCheckResult =
  | { kind: 'match'; sha: string }
  | { kind: 'mismatch'; docSha: string; headSha: string }
  | { kind: 'unreachable'; docSha: string; headSha: string }
  | { kind: 'unknown'; reason: 'doc-missing-sha' | 'workspace-not-repo' };

export interface CheckHeadShaDeps {
  workspaceRoot: string;
  docHeadSha: string | undefined;
  run?: GitRunner;
  getHeadSha?: typeof getHeadSha;
  objectExists?: typeof objectExists;
}

export async function checkHeadSha(deps: CheckHeadShaDeps): Promise<ShaCheckResult> {
  if (deps.docHeadSha === undefined) {
    return { kind: 'unknown', reason: 'doc-missing-sha' };
  }
  const getHead = deps.getHeadSha ?? getHeadSha;
  const objExists = deps.objectExists ?? objectExists;
  const run = deps.run ?? runGit;

  const headSha = await getHead(deps.workspaceRoot, run);
  if (headSha === null) {
    return { kind: 'unknown', reason: 'workspace-not-repo' };
  }

  if (headSha === deps.docHeadSha) {
    return { kind: 'match', sha: headSha };
  }

  const reachable = await objExists(deps.docHeadSha, deps.workspaceRoot, run);
  return reachable
    ? { kind: 'mismatch', docSha: deps.docHeadSha, headSha }
    : { kind: 'unreachable', docSha: deps.docHeadSha, headSha };
}

export function shortSha(s: string): string {
  return s.slice(0, 8);
}
