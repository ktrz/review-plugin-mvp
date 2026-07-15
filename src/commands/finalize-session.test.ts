import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFinalizeHandler,
  FINALIZE_SESSION_COMMAND_ID,
  type FinalizeDeps,
} from './finalize-session';
import type { LoadedFindings } from '../runtime/findings-state';
import {
  HandoverDocumentSchema,
  type FindingItem,
  type HandoverDocument,
  type StatusMarker,
} from '../schema';

type FakeWindow = FinalizeDeps['window'];
type FakeLog = FinalizeDeps['log'];
type FakeClipboard = FinalizeDeps['clipboard'];

const FILE_PATH = '/tmp/repo/pr-42-auto-review.md';
const KNOWN_MTIME = 1000;
const KNOWN_SHA = 'aaaa1111';

function makeItem(id: string, status: StatusMarker): FindingItem {
  const requiresResolution = status === 'resolved' || status === 'custom';
  return HandoverDocumentSchema.parse({
    header: {
      prUrl: 'https://github.com/octo/repo/pull/42',
      prNumber: 42,
      branch: { head: { ref: 'feat/x' }, base: { ref: 'main' } },
      generatedAt: '2026-01-01T00:00:00Z',
      status: 'PENDING REVIEW',
    },
    items: [
      {
        id,
        status,
        source: { kind: 'auto-review', severity: 'important' },
        location: { kind: 'file', file: 'src/x.ts', line: 1 },
        reportedBy: ['auto-review'],
        comment: `comment-${id}`,
        analysis: `analysis-${id}`,
        recommendation: `recommendation-${id}`,
        options: [`option-${id}`],
        resolution: requiresResolution ? 'done' : '',
        dirty: false,
        rawSource: `raw-${id}`,
      },
    ],
  }).items[0]!;
}

function makeDoc(items: FindingItem[]): HandoverDocument {
  return HandoverDocumentSchema.parse({
    header: {
      prUrl: 'https://github.com/octo/repo/pull/42',
      prNumber: 42,
      branch: { head: { ref: 'feat/x' }, base: { ref: 'main' } },
      generatedAt: '2026-01-01T00:00:00Z',
      status: 'PENDING REVIEW',
    },
    items,
  });
}

const makeState = (overrides: Partial<LoadedFindings> = {}): LoadedFindings => {
  const base: LoadedFindings = {
    doc: makeDoc([makeItem('i1', 'resolved')]),
    mtime: KNOWN_MTIME,
    filePath: FILE_PATH,
    prNumber: 42,
    lastWriteSha: KNOWN_SHA,
  };
  return { ...base, ...overrides };
};

function makeWindow() {
  const showInformationMessage = vi.fn<
    [string, ...string[]],
    Promise<string | undefined>
  >(async () => undefined);
  const showWarningMessage = vi.fn<
    [string, ...string[]],
    Promise<string | undefined>
  >(async () => undefined);
  const showErrorMessage = vi.fn<
    [string, ...string[]],
    Promise<string | undefined>
  >(async () => undefined);
  const window: FakeWindow = {
    showInformationMessage,
    showWarningMessage,
    showErrorMessage,
  };
  return { window, showInformationMessage, showWarningMessage, showErrorMessage };
}

function makeLog() {
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  const appendLine = vi.fn();
  const show = vi.fn();
  const log: FakeLog = { info, warn, error, appendLine, show };
  return { log, info, warn, error, appendLine, show };
}

function makeClipboard() {
  const writeText = vi.fn(async (_text: string) => {});
  const clipboard: FakeClipboard = { writeText };
  return { clipboard, writeText };
}

function makeDeps(overrides: Partial<FinalizeDeps> = {}) {
  const getState = vi.fn(() => makeState());
  const stat = vi.fn(async (_p: string) => ({ mtimeMs: KNOWN_MTIME }));
  const readFile = vi.fn(async (_p: string) => 'disk-bytes');
  const sha256 = vi.fn((_d: string) => KNOWN_SHA);
  const winBundle = makeWindow();
  const logBundle = makeLog();
  const clipBundle = makeClipboard();

  const deps: FinalizeDeps = {
    getState,
    stat,
    readFile,
    sha256,
    window: winBundle.window,
    log: logBundle.log,
    clipboard: clipBundle.clipboard,
    ...overrides,
  };

  return {
    deps,
    getState,
    stat,
    readFile,
    sha256,
    window: winBundle.window,
    log: logBundle.log,
    clipboard: clipBundle.clipboard,
    showInformationMessage: winBundle.showInformationMessage,
    showWarningMessage: winBundle.showWarningMessage,
    showErrorMessage: winBundle.showErrorMessage,
    appendLine: logBundle.appendLine,
    showChannel: logBundle.show,
    writeText: clipBundle.writeText,
    warn: logBundle.warn,
    error: logBundle.error,
    info: logBundle.info,
  };
}

describe('createFinalizeHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('exports the canonical command id', () => {
    expect(FINALIZE_SESSION_COMMAND_ID).toBe('reviewPlugin.session.finalize');
  });

  it('shows info message and aborts when no findings are loaded', async () => {
    const bundle = makeDeps({ getState: vi.fn(() => null) });
    const handler = createFinalizeHandler(bundle.deps);

    await handler();

    expect(bundle.showInformationMessage).toHaveBeenCalledWith(
      'No review session active.',
    );
    expect(bundle.stat).not.toHaveBeenCalled();
    expect(bundle.readFile).not.toHaveBeenCalled();
    expect(bundle.appendLine).not.toHaveBeenCalled();
    expect(bundle.info).toHaveBeenCalledWith(
      'Finalize session: no review session active.',
    );
  });

  it('shows error and logs when findings file is missing on disk (ENOENT)', async () => {
    const enoent = Object.assign(new Error('ENOENT: missing'), { code: 'ENOENT' });
    const bundle = makeDeps({
      stat: vi.fn(async () => {
        throw enoent;
      }),
    });
    const handler = createFinalizeHandler(bundle.deps);

    await handler();

    expect(bundle.showErrorMessage).toHaveBeenCalledWith(
      `Findings file not found at ${FILE_PATH}.`,
    );
    expect(bundle.error).toHaveBeenCalledWith(
      `Findings file not found at ${FILE_PATH}.`,
    );
    expect(bundle.appendLine).not.toHaveBeenCalled();
    expect(bundle.showInformationMessage).not.toHaveBeenCalled();
    expect(bundle.showWarningMessage).not.toHaveBeenCalled();
  });

  it('warns and aborts on mtime + sha drift (external edit)', async () => {
    const stat = vi.fn(async () => ({ mtimeMs: KNOWN_MTIME + 5 }));
    const readFile = vi.fn(async () => 'external-bytes');
    const sha256 = vi.fn(() => 'external-sha');
    const bundle = makeDeps({ stat, readFile, sha256 });
    const handler = createFinalizeHandler(bundle.deps);

    await handler();

    expect(readFile).toHaveBeenCalledWith(FILE_PATH);
    expect(bundle.showWarningMessage).toHaveBeenCalledWith(
      'Findings file changed on disk — reload first.',
    );
    expect(bundle.warn).toHaveBeenCalled();
    expect(bundle.appendLine).not.toHaveBeenCalled();
    expect(bundle.showInformationMessage).not.toHaveBeenCalled();
  });

  it('proceeds when mtime differs but sha matches (self-write false alarm)', async () => {
    const bundle = makeDeps({
      stat: vi.fn(async () => ({ mtimeMs: KNOWN_MTIME + 5 })),
      readFile: vi.fn(async () => 'plugin-wrote'),
      sha256: vi.fn(() => KNOWN_SHA),
      getState: vi.fn(() =>
        makeState({
          doc: makeDoc([makeItem('i1', 'resolved')]),
        }),
      ),
    });
    const handler = createFinalizeHandler(bundle.deps);

    await handler();

    expect(bundle.showWarningMessage).not.toHaveBeenCalled();
    expect(bundle.appendLine).toHaveBeenCalledTimes(1);
    const block = bundle.appendLine.mock.calls[0]?.[0];
    expect(block).toContain('Review session — 1 items');
    expect(block).toContain('  resolved:   1  [x]');
    expect(bundle.showInformationMessage).toHaveBeenCalled();
  });

  it('shows info + copies CLI command when zero incomplete items and user clicks Copy command', async () => {
    const bundle = makeDeps({
      getState: vi.fn(() =>
        makeState({
          doc: makeDoc([
            makeItem('i1', 'resolved'),
            makeItem('i2', 'skipped'),
          ]),
        }),
      ),
    });
    bundle.showInformationMessage
      .mockResolvedValueOnce('Copy command')
      .mockResolvedValueOnce(undefined);
    const handler = createFinalizeHandler(bundle.deps);

    await handler();

    expect(bundle.appendLine).toHaveBeenCalledTimes(1);
    expect(bundle.showInformationMessage).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('Review session complete'),
      'Copy command',
    );
    expect(bundle.writeText).toHaveBeenCalledWith(
      `claude "/execute-review-decisions ${FILE_PATH}"`,
    );
    expect(bundle.showInformationMessage).toHaveBeenNthCalledWith(
      2,
      'Command copied.',
    );
  });

  it('does not copy when user dismisses the info toast', async () => {
    const bundle = makeDeps({
      getState: vi.fn(() =>
        makeState({
          doc: makeDoc([makeItem('i1', 'resolved')]),
        }),
      ),
    });
    bundle.showInformationMessage.mockResolvedValue(undefined);
    const handler = createFinalizeHandler(bundle.deps);

    await handler();

    expect(bundle.writeText).not.toHaveBeenCalled();
  });

  it('shows warning toast with counts when incomplete items exist; Cancel keeps clipboard untouched and channel hidden', async () => {
    const bundle = makeDeps({
      getState: vi.fn(() =>
        makeState({
          doc: makeDoc([
            makeItem('i1', 'unresolved'),
            makeItem('i2', 'deferred'),
            makeItem('i3', 'resolved'),
          ]),
        }),
      ),
    });
    bundle.showWarningMessage.mockResolvedValueOnce('Cancel');
    const handler = createFinalizeHandler(bundle.deps);

    await handler();

    expect(bundle.appendLine).toHaveBeenCalledTimes(1);
    const block = bundle.appendLine.mock.calls[0]?.[0];
    expect(block).toContain('Review session — 3 items');
    expect(block).toContain('  unresolved: 1  [?]');
    expect(block).toContain('  deferred:   1  [d]');
    expect(bundle.showWarningMessage).toHaveBeenCalledWith(
      '2 items still need attention (1 unresolved, 1 deferred) — finalize anyway?',
      'Show summary',
      'Cancel',
    );
    expect(bundle.writeText).not.toHaveBeenCalled();
    expect(bundle.showChannel).not.toHaveBeenCalled();
    expect(bundle.showInformationMessage).not.toHaveBeenCalled();
  });

  it('reveals the output channel when user clicks Show summary on incomplete warning', async () => {
    const bundle = makeDeps({
      getState: vi.fn(() =>
        makeState({
          doc: makeDoc([makeItem('i1', 'unresolved')]),
        }),
      ),
    });
    bundle.showWarningMessage.mockResolvedValueOnce('Show summary');
    const handler = createFinalizeHandler(bundle.deps);

    await handler();

    expect(bundle.showChannel).toHaveBeenCalledWith(true);
    expect(bundle.writeText).not.toHaveBeenCalled();
  });

  it('surfaces unexpected errors via showErrorMessage and log.error', async () => {
    const bundle = makeDeps({
      stat: vi.fn(async () => {
        throw new Error('disk gremlins');
      }),
    });
    const handler = createFinalizeHandler(bundle.deps);

    await handler();

    expect(bundle.error).toHaveBeenCalledWith(
      expect.stringContaining('Finalize session failed'),
    );
    expect(bundle.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('disk gremlins'),
    );
  });
});
