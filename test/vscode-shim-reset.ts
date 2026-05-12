import { beforeEach, vi } from 'vitest';
import { __resetShimNamespaces } from './vscode-shim';

beforeEach(() => {
  vi.clearAllMocks();
  __resetShimNamespaces();
});
