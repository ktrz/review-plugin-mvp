import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { safeSetContext, type ContextLog } from './vscode-context';

function makeLog(): { log: ContextLog; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn();
  return { log: { warn }, warn };
}

describe('safeSetContext', () => {
  const executeCommand = vscode.commands.executeCommand as ReturnType<
    typeof vi.fn
  >;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('invokes vscode.commands.executeCommand with setContext + key + value', () => {
    executeCommand.mockReturnValue(Promise.resolve());
    const { log } = makeLog();

    safeSetContext(log, 'reviewPlugin.hasFindings', true);

    expect(executeCommand).toHaveBeenCalledWith(
      'setContext',
      'reviewPlugin.hasFindings',
      true,
    );
  });

  it('logs a warning when the setContext promise rejects with an Error', async () => {
    executeCommand.mockReturnValue(Promise.reject(new Error('vscode boom')));
    const { log, warn } = makeLog();

    safeSetContext(log, 'reviewPlugin.hasFindings', false);

    await new Promise((resolve) => setImmediate(resolve));

    expect(warn).toHaveBeenCalledWith(
      'setContext failed for reviewPlugin.hasFindings: vscode boom',
    );
  });

  it('logs a warning when the setContext promise rejects with a non-Error', async () => {
    executeCommand.mockReturnValue(Promise.reject('plain string'));
    const { log, warn } = makeLog();

    safeSetContext(log, 'reviewPlugin.hasFindings', true);

    await new Promise((resolve) => setImmediate(resolve));

    expect(warn).toHaveBeenCalledWith(
      'setContext failed for reviewPlugin.hasFindings: plain string',
    );
  });

  it('does not log on success', async () => {
    executeCommand.mockReturnValue(Promise.resolve());
    const { log, warn } = makeLog();

    safeSetContext(log, 'reviewPlugin.hasFindings', true);

    await new Promise((resolve) => setImmediate(resolve));

    expect(warn).not.toHaveBeenCalled();
  });
});
