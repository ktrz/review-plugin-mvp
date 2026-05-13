import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { activate, deactivate } from './extension';
import {
  __resetActiveWatcherForTests,
} from './commands/load-findings';
import { THREAD_COMMAND_IDS } from './commands/thread-actions';
import { clearState, __resetOutputChannelForTests } from './runtime/findings-state';

const makeChannel = (): vscode.OutputChannel => {
  const fake: Partial<vscode.OutputChannel> = {
    name: 'Review Plugin',
    appendLine: vi.fn(),
    append: vi.fn(),
    clear: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    replace: vi.fn(),
  };
  return fake as vscode.OutputChannel;
};

const makeController = (): vscode.CommentController => {
  const fake: Partial<vscode.CommentController> = {
    id: 'reviewPlugin.findings',
    label: 'Review Plugin',
    createCommentThread: vi.fn(),
    dispose: vi.fn(),
  };
  return fake as vscode.CommentController;
};

describe('activate', () => {
  beforeEach(() => {
    __resetActiveWatcherForTests();
    __resetOutputChannelForTests();
    clearState();
    (vscode.window.createOutputChannel as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChannel(),
    );
    (vscode.comments.createCommentController as ReturnType<typeof vi.fn>).mockReturnValue(
      makeController(),
    );
    (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ dispose: vi.fn() }),
    );
  });

  afterEach(() => {
    deactivate();
    __resetActiveWatcherForTests();
    __resetOutputChannelForTests();
    clearState();
  });

  it('registers loadFindings + all four thread commands', () => {
    const subscriptions: vscode.Disposable[] = [];
    const context = {
      subscriptions,
    } as Partial<vscode.ExtensionContext> as vscode.ExtensionContext;

    activate(context);

    const registerCalls = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>)
      .mock.calls.map((c) => c[0] as string);
    expect(registerCalls).toContain('reviewPlugin.loadFindings');
    expect(registerCalls).toContain(THREAD_COMMAND_IDS.post);
    expect(registerCalls).toContain(THREAD_COMMAND_IDS.dismiss);
    expect(registerCalls).toContain(THREAD_COMMAND_IDS.discuss);
    expect(registerCalls).toContain(THREAD_COMMAND_IDS.unresolve);
  });
});
