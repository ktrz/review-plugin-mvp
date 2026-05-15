import { createHash } from 'node:crypto';
import { writeFile as fsWriteFile, stat as fsStat } from 'node:fs/promises';

export type WriteResult = {
  mtime: number;
  sha: string;
};

export type FindingsWriterDeps = {
  writeFile?: (filePath: string, data: string) => Promise<void>;
  stat?: (filePath: string) => Promise<{ mtimeMs: number }>;
  sha256?: (data: string) => string;
};

export type FindingsWriter = {
  write: (filePath: string, serialized: string) => Promise<WriteResult>;
  getLastWriteSha: (filePath: string) => string | undefined;
};

export function createFindingsWriter(deps: FindingsWriterDeps = {}): FindingsWriter {
  const writeFile = deps.writeFile ?? ((p: string, data: string) => fsWriteFile(p, data, 'utf8'));
  const stat = deps.stat ?? (async (p: string) => {
    const s = await fsStat(p);
    return { mtimeMs: s.mtimeMs };
  });
  const sha256 = deps.sha256 ?? defaultSha256;
  const lastShaByPath = new Map<string, string>();

  return {
    async write(filePath, serialized) {
      const sha = sha256(serialized);
      const previous = lastShaByPath.get(filePath);
      lastShaByPath.set(filePath, sha);
      try {
        await writeFile(filePath, serialized);
      } catch (err) {
        if (previous === undefined) {
          lastShaByPath.delete(filePath);
        } else {
          lastShaByPath.set(filePath, previous);
        }
        throw err;
      }
      const s = await stat(filePath);
      return { mtime: s.mtimeMs, sha };
    },
    getLastWriteSha(filePath) {
      return lastShaByPath.get(filePath);
    },
  };
}

function defaultSha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex').slice(0, 8);
}
