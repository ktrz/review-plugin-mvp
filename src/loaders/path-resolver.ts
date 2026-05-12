import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import * as vscode from 'vscode';
import { z } from 'zod';

export type PickFile = (defaultUri: vscode.Uri) => Promise<string | null>;
export type ReadFile = (filePath: string, encoding: 'utf8') => Promise<string>;
export type Access = (filePath: string) => Promise<void>;

export interface ResolveFindingsPathDeps {
  workspaceRoot: string;
  prNumber: number;
  readFile?: ReadFile;
  access?: Access;
  pickFile?: PickFile;
}

const ReviewYamlSchema = z.object({ output_dir: z.string() }).passthrough();

const REPO_TOKEN = '<repo>';

const defaultPickFile: PickFile = async (defaultUri) => {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { Markdown: ['md'] },
    defaultUri,
    openLabel: 'Load findings',
  });
  if (!picked || picked.length === 0) {return null;}
  return picked[0]!.fsPath;
};

export async function resolveFindingsPath(deps: ResolveFindingsPathDeps): Promise<string | null> {
  const {
    workspaceRoot,
    prNumber,
    readFile = fs.promises.readFile,
    access = fs.promises.access,
    pickFile = defaultPickFile,
  } = deps;

  const fileName = `pr-${prNumber}-auto-review.md`;
  const repoBase = path.basename(workspaceRoot);

  const yamlCandidate = await tryYamlCandidate({
    workspaceRoot,
    fileName,
    repoBase,
    readFile,
    access,
  });
  if (yamlCandidate !== null) {return yamlCandidate;}

  const fallback = path.join(workspaceRoot, 'plans.local', repoBase, fileName);
  if (await pathExists(fallback, access)) {return fallback;}

  return pickFile(vscode.Uri.file(workspaceRoot) as vscode.Uri);
}

interface YamlCandidateDeps {
  workspaceRoot: string;
  fileName: string;
  repoBase: string;
  readFile: ReadFile;
  access: Access;
}

async function tryYamlCandidate(deps: YamlCandidateDeps): Promise<string | null> {
  const { workspaceRoot, fileName, repoBase, readFile, access } = deps;
  const yamlPath = path.join(workspaceRoot, '.claude', 'review.yaml');

  const outputDir = await readOutputDir(yamlPath, readFile);
  if (outputDir === null) {return null;}

  const substituted = substituteRepo(outputDir, repoBase);
  const resolvedDir = path.isAbsolute(substituted)
    ? substituted
    : path.resolve(workspaceRoot, substituted);
  const candidate = path.join(resolvedDir, fileName);

  if (await pathExists(candidate, access)) {return candidate;}
  return null;
}

async function readOutputDir(
  yamlPath: string,
  readFile: ReadFile,
): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(yamlPath, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    return null;
  }
  const result = ReviewYamlSchema.safeParse(parsed);
  if (!result.success) {return null;}
  return result.data.output_dir;
}

function substituteRepo(template: string, repoBase: string): string {
  const idx = template.indexOf(REPO_TOKEN);
  if (idx === -1) {return template;}
  return template.slice(0, idx) + repoBase + template.slice(idx + REPO_TOKEN.length);
}

async function pathExists(
  candidate: string,
  access: Access,
): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}
