import fs from 'node:fs';
import { parseDocument, type HandoverDocument } from '../schema';

export type ReadFile = (filePath: string, encoding: 'utf8') => Promise<string>;
export type Stat = (filePath: string) => Promise<{ mtimeMs: number }>;

export interface LoadFindingsFileDeps {
  readFile?: ReadFile;
  stat?: Stat;
}

export interface LoadedFindingsFile {
  doc: Readonly<HandoverDocument>;
  mtime: number;
}

export async function loadFindingsFile(
  filePath: string,
  deps: LoadFindingsFileDeps = {},
): Promise<LoadedFindingsFile> {
  const { readFile = fs.promises.readFile, stat = fs.promises.stat } = deps;

  const stats = await stat(filePath);
  const raw = await readFile(filePath, 'utf8');
  const doc = parseDocument(raw);
  return { doc, mtime: stats.mtimeMs };
}
