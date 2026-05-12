import { vi } from 'vitest';

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
}

export class Range {
  public readonly start: Position;
  public readonly end: Position;

  constructor(
    startLine: number | Position,
    startCharacter: number | Position,
    endLine?: number,
    endCharacter?: number,
  ) {
    if (startLine instanceof Position && startCharacter instanceof Position) {
      this.start = startLine;
      this.end = startCharacter;
      return;
    }
    if (
      typeof startLine === 'number' &&
      typeof startCharacter === 'number' &&
      typeof endLine === 'number' &&
      typeof endCharacter === 'number'
    ) {
      this.start = new Position(startLine, startCharacter);
      this.end = new Position(endLine, endCharacter);
      return;
    }
    throw new Error('Range constructor: invalid arguments');
  }
}

export const Uri = {
  file(p: string) {
    return {
      fsPath: p,
      scheme: 'file',
      path: p,
      toString: () => p,
    };
  },
};

export class RelativePattern {
  public readonly base: unknown;
  public readonly pattern: string;
  public readonly baseUri: unknown;

  constructor(base: unknown, pattern: string) {
    this.base = base;
    this.baseUri = base;
    this.pattern = pattern;
  }
}

export class MarkdownString {
  public value: string;
  public isTrusted = false;
  public supportHtml = false;

  constructor(value = '') {
    this.value = value;
  }

  appendMarkdown(md: string): this {
    this.value += md;
    return this;
  }

  appendText(text: string): this {
    this.value += text;
    return this;
  }
}

export const CommentMode = {
  Editing: 0,
  Preview: 1,
} as const;

export const CommentThreadCollapsibleState = {
  Collapsed: 0,
  Expanded: 1,
} as const;

type Listener<T> = (e: T) => unknown;

export class EventEmitter<T> {
  private listeners: Set<Listener<T>> = new Set();

  event = (cb: Listener<T>): { dispose(): void } => {
    this.listeners.add(cb);
    return {
      dispose: () => {
        this.listeners.delete(cb);
      },
    };
  };

  fire(payload: T): void {
    for (const cb of this.listeners) {
      cb(payload);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}

const makeNamespace = <K extends string>(keys: readonly K[]): Record<K, ReturnType<typeof vi.fn>> => {
  const ns = {} as Record<K, ReturnType<typeof vi.fn>>;
  for (const k of keys) {
    ns[k] = vi.fn();
  }
  return ns;
};

type WorkspaceFolderShim = { uri: { fsPath: string }; name: string; index: number };

export const workspace: ReturnType<typeof makeNamespace<'createFileSystemWatcher' | 'getConfiguration' | 'openTextDocument' | 'asRelativePath'>> & {
  workspaceFolders: ReadonlyArray<WorkspaceFolderShim> | undefined;
} = {
  ...makeNamespace([
    'createFileSystemWatcher',
    'getConfiguration',
    'openTextDocument',
    'asRelativePath',
  ] as const),
  workspaceFolders: undefined,
};

export const window = makeNamespace([
  'createOutputChannel',
  'showErrorMessage',
  'showWarningMessage',
  'showInformationMessage',
  'showInputBox',
  'showOpenDialog',
  'showQuickPick',
] as const);

export const commands = makeNamespace([
  'registerCommand',
  'executeCommand',
] as const);

export const comments = makeNamespace([
  'createCommentController',
] as const);

export function __resetShimNamespaces(): void {
  for (const ns of [workspace, window, commands, comments]) {
    for (const key of Object.keys(ns)) {
      const value = (ns as Record<string, unknown>)[key];
      if (typeof value === 'function' && 'mockReset' in (value as object)) {
        (value as ReturnType<typeof vi.fn>).mockReset();
      }
    }
  }
  workspace.workspaceFolders = undefined;
}
