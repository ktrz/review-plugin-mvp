import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/vscode-shim-reset.ts'],
    alias: {
      vscode: path.resolve(__dirname, 'test/vscode-shim.ts'),
    },
  },
});
