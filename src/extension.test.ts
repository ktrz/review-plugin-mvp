import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { activate, deactivate } from './extension';
import {
  __resetActiveWatcherForTests,
} from './commands/load-findings';
import { THREAD_COMMAND_IDS } from './commands/thread-actions';
import { FINALIZE_SESSION_COMMAND_ID } from './commands/finalize-session';
import { CHAT_SEND_COMMAND_ID } from './commands/chat-reply';
import { FINALIZE_CHAT_COMMAND_ID } from './commands/finalize-chat';
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

interface ControllerSpy extends vscode.CommentController {
  __setProvider?: (provider: vscode.CommentingRangeProvider) => void;
  __getProvider?: () => vscode.CommentingRangeProvider | undefined;
  __getOptions?: () => vscode.CommentOptions | undefined;
}

const makeController = (): ControllerSpy => {
  let provider: vscode.CommentingRangeProvider | undefined;
  let options: vscode.CommentOptions | undefined;
  const fake: Partial<ControllerSpy> = {
    id: 'reviewPlugin.findings',
    label: 'Review Plugin',
    createCommentThread: vi.fn(),
    dispose: vi.fn(),
    __setProvider(p) {
      provider = p;
    },
    __getProvider() {
      return provider;
    },
    __getOptions() {
      return options;
    },
  };
  Object.defineProperty(fake, 'commentingRangeProvider', {
    configurable: true,
    enumerable: true,
    get(): vscode.CommentingRangeProvider | undefined {
      return provider;
    },
    set(value: vscode.CommentingRangeProvider | undefined): void {
      provider = value;
    },
  });
  Object.defineProperty(fake, 'options', {
    configurable: true,
    enumerable: true,
    get(): vscode.CommentOptions | undefined {
      return options;
    },
    set(value: vscode.CommentOptions | undefined): void {
      options = value;
    },
  });
  return fake as ControllerSpy;
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

  it('registers loadFindings, finalize, all four thread commands, plus chat send + finalize-chat', () => {
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
    expect(registerCalls).toContain(FINALIZE_SESSION_COMMAND_ID);
    expect(registerCalls).toContain(CHAT_SEND_COMMAND_ID);
    expect(registerCalls).toContain(FINALIZE_CHAT_COMMAND_ID);
  });

  it('chat.send handler returns synchronously (fire-and-forget) so VS Code clears the reply input', () => {
    const subscriptions: vscode.Disposable[] = [];
    const context = {
      subscriptions,
    } as Partial<vscode.ExtensionContext> as vscode.ExtensionContext;
    activate(context);

    const calls = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
    const sendCall = calls.find((c) => c[0] === CHAT_SEND_COMMAND_ID);
    expect(sendCall).toBeDefined();
    const handler = sendCall?.[1] as (reply: unknown) => unknown;

    const fakeThread = {
      comments: [],
      label: '',
      contextValue: '',
      canReply: true,
    } as Partial<vscode.CommentThread> as vscode.CommentThread;
    const result = handler({ thread: fakeThread, text: 'hello' });
    expect(result).toBeUndefined();
  });

  it('chat.send handler returns undefined when invoked with no thread/text (no Promise to await)', () => {
    const subscriptions: vscode.Disposable[] = [];
    const context = {
      subscriptions,
    } as Partial<vscode.ExtensionContext> as vscode.ExtensionContext;
    activate(context);

    const calls = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
    const sendCall = calls.find((c) => c[0] === CHAT_SEND_COMMAND_ID);
    const handler = sendCall?.[1] as (reply: unknown) => unknown;
    expect(handler(undefined)).toBeUndefined();
  });

  it('leaves commentingRangeProvider unset (no new-thread UI) and wires reply prompt options', () => {
    const controller = makeController();
    (vscode.comments.createCommentController as ReturnType<typeof vi.fn>).mockReturnValue(
      controller,
    );
    const subscriptions: vscode.Disposable[] = [];
    const context = {
      subscriptions,
    } as Partial<vscode.ExtensionContext> as vscode.ExtensionContext;

    activate(context);

    const provider = controller.__getProvider?.();
    expect(provider).toBeUndefined();

    const options = controller.__getOptions?.();
    expect(options).toBeDefined();
    expect(options?.prompt).toBe('Reply…');
    expect(options?.placeHolder).toBe('Type your message');
  });

  it('seeds reviewPlugin.hasFindings = false on activation', () => {
    const subscriptions: vscode.Disposable[] = [];
    const context = {
      subscriptions,
    } as Partial<vscode.ExtensionContext> as vscode.ExtensionContext;

    activate(context);

    const executeCalls = (vscode.commands.executeCommand as ReturnType<typeof vi.fn>)
      .mock.calls;
    const setContextCall = executeCalls.find(
      (c) => c[0] === 'setContext' && c[1] === 'reviewPlugin.hasFindings',
    );
    expect(setContextCall).toBeDefined();
    expect(setContextCall?.[2]).toBe(false);
  });
});
