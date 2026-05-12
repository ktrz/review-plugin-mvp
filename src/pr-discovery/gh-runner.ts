import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';

export type GhRunner = (
  args: string[],
  opts: { cwd: string },
) => Promise<{ stdout: string }>;

export type AskUser = () => Promise<string | undefined>;

export interface DiscoverPrNumberDeps {
  workspaceRoot: string;
  runGh?: GhRunner;
  askUser?: AskUser;
}

export async function discoverPrNumber(
  deps: DiscoverPrNumberDeps,
): Promise<number | null> {
  const runGh = deps.runGh ?? defaultRunGh;
  const askUser = deps.askUser ?? defaultAskUser;

  const fromGh = await tryGhPrView(runGh, deps.workspaceRoot);
  if (fromGh !== null) {
    return fromGh;
  }

  const raw = await askUser();
  if (raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }
  return toPositivePrNumber(trimmed);
}

async function tryGhPrView(runGh: GhRunner, cwd: string): Promise<number | null> {
  let stdout: string;
  try {
    const result = await runGh(['pr', 'view', '--json', 'number'], { cwd });
    stdout = result.stdout;
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const candidate = (parsed as { number?: unknown }).number;
  return toPositivePrNumber(candidate);
}

function toPositivePrNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    return null;
  }
  return n;
}

const execFileAsync = promisify(execFile);

const defaultRunGh: GhRunner = async (args, opts) => {
  const { stdout } = await execFileAsync('gh', args, { cwd: opts.cwd });
  return { stdout: stdout.toString() };
};

const defaultAskUser: AskUser = async () => {
  return vscode.window.showInputBox({
    prompt: 'PR number',
    validateInput: (v) => (/^\d+$/.test(v) ? null : 'Numeric PR number required'),
  });
};
