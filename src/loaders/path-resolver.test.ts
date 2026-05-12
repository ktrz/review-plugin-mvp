import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { resolveFindingsPath, type PickFile } from './path-resolver';

const WORKSPACE = '/tmp/wsroot/my-repo';
const PR = 42;
const FILE_NAME = `pr-${PR}-auto-review.md`;

type ReadFileFn = (filePath: string, encoding: 'utf8') => Promise<string>;
type AccessFn = (filePath: string) => Promise<void>;

function makeReadFile(map: Record<string, string>): ReadFileFn {
  return vi.fn(async (filePath: string) => {
    if (filePath in map) {return map[filePath]!;}
    const err = Object.assign(new Error(`ENOENT: ${filePath}`), { code: 'ENOENT' });
    throw err;
  });
}

function makeAccess(existing: ReadonlySet<string>): AccessFn {
  return vi.fn(async (filePath: string) => {
    if (existing.has(filePath)) {return;}
    const err = Object.assign(new Error(`ENOENT: ${filePath}`), { code: 'ENOENT' });
    throw err;
  });
}

describe('resolveFindingsPath', () => {
  it('returns yaml-configured path when output_dir resolves and file exists', async () => {
    const yamlPath = path.join(WORKSPACE, '.claude', 'review.yaml');
    const expected = path.join(WORKSPACE, 'plans.local', 'my-repo', FILE_NAME);
    const readFile = makeReadFile({
      [yamlPath]: 'output_dir: plans.local/<repo>\n',
    });
    const access = makeAccess(new Set([expected]));
    const pickFile = vi.fn();

    const result = await resolveFindingsPath({
      workspaceRoot: WORKSPACE,
      prNumber: PR,
      readFile,
      access,
      pickFile,
    });

    expect(result).toBe(expected);
    expect(pickFile).not.toHaveBeenCalled();
  });

  it('honors absolute output_dir without joining workspace root', async () => {
    const yamlPath = path.join(WORKSPACE, '.claude', 'review.yaml');
    const absDir = '/var/findings';
    const expected = path.join(absDir, FILE_NAME);
    const readFile = makeReadFile({
      [yamlPath]: `output_dir: ${absDir}\n`,
    });
    const access = makeAccess(new Set([expected]));
    const pickFile = vi.fn();

    const result = await resolveFindingsPath({
      workspaceRoot: WORKSPACE,
      prNumber: PR,
      readFile,
      access,
      pickFile,
    });

    expect(result).toBe(expected);
  });

  it('falls back to plans.local/<repo> when yaml file is missing', async () => {
    const fallback = path.join(WORKSPACE, 'plans.local', 'my-repo', FILE_NAME);
    const readFile = makeReadFile({});
    const access = makeAccess(new Set([fallback]));
    const pickFile = vi.fn();

    const result = await resolveFindingsPath({
      workspaceRoot: WORKSPACE,
      prNumber: PR,
      readFile,
      access,
      pickFile,
    });

    expect(result).toBe(fallback);
    expect(pickFile).not.toHaveBeenCalled();
  });

  it('falls back when yaml is malformed', async () => {
    const yamlPath = path.join(WORKSPACE, '.claude', 'review.yaml');
    const fallback = path.join(WORKSPACE, 'plans.local', 'my-repo', FILE_NAME);
    const readFile = makeReadFile({
      [yamlPath]: 'output_dir: [unterminated\n',
    });
    const access = makeAccess(new Set([fallback]));
    const pickFile = vi.fn();

    const result = await resolveFindingsPath({
      workspaceRoot: WORKSPACE,
      prNumber: PR,
      readFile,
      access,
      pickFile,
    });

    expect(result).toBe(fallback);
  });

  it('falls back when yaml lacks output_dir', async () => {
    const yamlPath = path.join(WORKSPACE, '.claude', 'review.yaml');
    const fallback = path.join(WORKSPACE, 'plans.local', 'my-repo', FILE_NAME);
    const readFile = makeReadFile({
      [yamlPath]: 'something_else: hello\n',
    });
    const access = makeAccess(new Set([fallback]));
    const pickFile = vi.fn();

    const result = await resolveFindingsPath({
      workspaceRoot: WORKSPACE,
      prNumber: PR,
      readFile,
      access,
      pickFile,
    });

    expect(result).toBe(fallback);
  });

  it('falls back when yaml output_dir is wrong type', async () => {
    const yamlPath = path.join(WORKSPACE, '.claude', 'review.yaml');
    const fallback = path.join(WORKSPACE, 'plans.local', 'my-repo', FILE_NAME);
    const readFile = makeReadFile({
      [yamlPath]: 'output_dir: 42\n',
    });
    const access = makeAccess(new Set([fallback]));
    const pickFile = vi.fn();

    const result = await resolveFindingsPath({
      workspaceRoot: WORKSPACE,
      prNumber: PR,
      readFile,
      access,
      pickFile,
    });

    expect(result).toBe(fallback);
  });

  it('falls back when yaml-configured candidate file does not exist', async () => {
    const yamlPath = path.join(WORKSPACE, '.claude', 'review.yaml');
    const fallback = path.join(WORKSPACE, 'plans.local', 'my-repo', FILE_NAME);
    const readFile = makeReadFile({
      [yamlPath]: 'output_dir: out/<repo>\n',
    });
    const access = makeAccess(new Set([fallback]));
    const pickFile = vi.fn();

    const result = await resolveFindingsPath({
      workspaceRoot: WORKSPACE,
      prNumber: PR,
      readFile,
      access,
      pickFile,
    });

    expect(result).toBe(fallback);
  });

  it('substitutes only the first <repo> occurrence', async () => {
    const yamlPath = path.join(WORKSPACE, '.claude', 'review.yaml');
    const expected = path.join(WORKSPACE, 'a', 'my-repo', '<repo>', FILE_NAME);
    const readFile = makeReadFile({
      [yamlPath]: 'output_dir: a/<repo>/<repo>\n',
    });
    const access = makeAccess(new Set([expected]));
    const pickFile = vi.fn();

    const result = await resolveFindingsPath({
      workspaceRoot: WORKSPACE,
      prNumber: PR,
      readFile,
      access,
      pickFile,
    });

    expect(result).toBe(expected);
  });

  it('invokes pickFile when both yaml and fallback miss, returns picked path', async () => {
    const picked = '/elsewhere/findings.md';
    const readFile = makeReadFile({});
    const access = makeAccess(new Set());
    const seenDefaultUris: Array<{ fsPath: string }> = [];
    const pickFile: PickFile = vi.fn(async (uri) => {
      seenDefaultUris.push(uri);
      return picked;
    });

    const result = await resolveFindingsPath({
      workspaceRoot: WORKSPACE,
      prNumber: PR,
      readFile,
      access,
      pickFile,
    });

    expect(result).toBe(picked);
    expect(pickFile).toHaveBeenCalledTimes(1);
    expect(seenDefaultUris[0]?.fsPath).toBe(WORKSPACE);
  });

  it('returns null when picker is cancelled', async () => {
    const readFile = makeReadFile({});
    const access = makeAccess(new Set());
    const pickFile: PickFile = vi.fn(async () => null);

    const result = await resolveFindingsPath({
      workspaceRoot: WORKSPACE,
      prNumber: PR,
      readFile,
      access,
      pickFile,
    });

    expect(result).toBeNull();
  });

  it('uses default vscode picker when pickFile not injected and both candidates miss', async () => {
    const readFile = makeReadFile({});
    const access = makeAccess(new Set());
    const picked = '/picked/by-vscode.md';
    (vscode.window.showOpenDialog as ReturnType<typeof vi.fn>).mockResolvedValue([
      { fsPath: picked },
    ]);

    const result = await resolveFindingsPath({
      workspaceRoot: WORKSPACE,
      prNumber: PR,
      readFile,
      access,
    });

    expect(result).toBe(picked);
    expect(vscode.window.showOpenDialog).toHaveBeenCalledTimes(1);
  });

  it('default picker returns null when user cancels (undefined)', async () => {
    const readFile = makeReadFile({});
    const access = makeAccess(new Set());
    (vscode.window.showOpenDialog as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await resolveFindingsPath({
      workspaceRoot: WORKSPACE,
      prNumber: PR,
      readFile,
      access,
    });

    expect(result).toBeNull();
  });
});
