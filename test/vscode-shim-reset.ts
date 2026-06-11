import { beforeEach, vi } from 'vitest';
import { __resetShimNamespaces } from './vscode-shim';
import { clearPersonaIcons } from '../src/comments/persona-icons';

beforeEach(() => {
  vi.clearAllMocks();
  __resetShimNamespaces();
  clearPersonaIcons();
});
