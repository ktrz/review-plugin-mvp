import { isAbsolute, resolve } from 'node:path';

export function resolveHunkPath(filePath: string, workspaceRoot: string): string {
  if (isAbsolute(filePath)) {
    return filePath;
  }
  return resolve(workspaceRoot, filePath);
}
