import * as vscode from 'vscode';

export type ContextLog = {
  warn: (msg: string) => void;
};

export function safeSetContext(
  log: ContextLog,
  key: string,
  value: unknown,
): void {
  const result = vscode.commands.executeCommand('setContext', key, value);
  Promise.resolve(result).then(
    () => undefined,
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`setContext failed for ${key}: ${message}`);
    },
  );
}
