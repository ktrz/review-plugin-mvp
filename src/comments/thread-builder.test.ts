import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  FindingItemSchema,
  type FindingItem,
  type Severity,
  type StatusMarker,
} from '../schema';
import {
  buildThreadEntry,
} from './thread-builder';
import {
  clearPersonaIcons,
  setPersonaIcons,
  type PersonaIcons,
} from './persona-icons';
import {
  cachedRoundAvatar,
  clearAvatarCache,
  ensureRoundAvatar,
} from './avatar-cache';

type FakeThread = {
  uri: vscode.Uri;
  range: vscode.Range;
  comments: readonly vscode.Comment[];
  label: string;
  contextValue: string;
  canReply: boolean;
  collapsibleState: vscode.CommentThreadCollapsibleState;
  state: vscode.CommentThreadState;
  dispose: ReturnType<typeof vi.fn>;
};

const makeFakeController = () => {
  let last: FakeThread | null = null;
  const createCommentThread = vi.fn((uri, range, comments): vscode.CommentThread => {
    const thread: FakeThread = {
      uri,
      range,
      comments,
      label: '',
      contextValue: '',
      canReply: false,
      collapsibleState: vscode.CommentThreadCollapsibleState.Collapsed,
      state: vscode.CommentThreadState.Unresolved,
      dispose: vi.fn(),
    };
    last = thread;
    return thread satisfies Partial<vscode.CommentThread> as vscode.CommentThread;
  });
  const fake = {
    id: 'reviewPlugin.findings',
    label: 'Review Plugin',
    createCommentThread,
    dispose: vi.fn(),
  } satisfies Partial<vscode.CommentController>;
  return {
    controller: fake as vscode.CommentController,
    createCommentThread,
    lastThread: () => {
      if (last === null) {throw new Error('createCommentThread not called');}
      return last;
    },
  };
};

interface MakeFindingOptions {
  status?: StatusMarker;
  sourceKind?: 'auto-review' | 'reviewer';
  login?: string;
  severity?: Severity;
  locationKind?: 'file' | 'review-body';
  file?: string;
  line?: number;
  options?: string[];
  resolution?: string;
  comment?: string;
  analysis?: string;
  recommendation?: string;
  chat?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
}

const makeFinding = (opts: MakeFindingOptions = {}): FindingItem => {
  const sourceKind = opts.sourceKind ?? 'auto-review';
  const severity = opts.severity ?? 'critical';
  const source =
    sourceKind === 'auto-review'
      ? { kind: 'auto-review', severity }
      : { kind: 'reviewer', login: opts.login ?? 'alice', severity };
  const location =
    (opts.locationKind ?? 'file') === 'file'
      ? {
          kind: 'file',
          file: opts.file ?? 'src/router.ts',
          line: opts.line ?? 42,
        }
      : { kind: 'review-body' };
  const status = opts.status ?? 'unresolved';
  const resolution =
    opts.resolution ??
    (status === 'resolved' || status === 'custom' ? 'fixed in follow-up' : '');
  const base = {
    id: 'test-id',
    dirty: false,
    rawSource: 'raw',
    status,
    source,
    location,
    reportedBy: ['auto-review'],
    comment: opts.comment ?? 'something is off',
    analysis: opts.analysis ?? 'detailed analysis',
    recommendation: opts.recommendation ?? 'do the thing',
    options: opts.options ?? ['option one', 'option two'],
    resolution,
  };
  const payload = opts.chat === undefined ? base : { ...base, chat: opts.chat };
  return FindingItemSchema.parse(payload);
};

const withId = (item: FindingItem, id = 'id-test'): FindingItem =>
  Object.assign({}, item, { id });

describe('buildThreadEntry', () => {
  describe('location filtering', () => {
    it('returns null when finding location.kind is review-body', () => {
      const { controller, createCommentThread } = makeFakeController();
      const finding = makeFinding({ locationKind: 'review-body' });
      const result = buildThreadEntry({ finding, controller, workspaceRoot: '/repo' });
      expect(result).toBeNull();
      expect(createCommentThread).not.toHaveBeenCalled();
    });
  });

  describe('anchor', () => {
    it('joins relative file path to workspace root and uses zero-width range at line-1', () => {
      const { controller, createCommentThread } = makeFakeController();
      const finding = makeFinding({ file: 'src/router.ts', line: 42 });
      buildThreadEntry({ finding, controller, workspaceRoot: '/repo' });
      expect(createCommentThread).toHaveBeenCalledTimes(1);
      const [uri, range] = createCommentThread.mock.calls[0];
      expect((uri as { fsPath: string }).fsPath).toBe(path.resolve('/repo', 'src/router.ts'));
      expect(range).toBeInstanceOf(vscode.Range);
      expect(range.start.line).toBe(41);
      expect(range.start.character).toBe(0);
      expect(range.end.line).toBe(41);
      expect(range.end.character).toBe(0);
    });

    it('passes absolute file paths through path.resolve unchanged', () => {
      const { controller, createCommentThread } = makeFakeController();
      const finding = makeFinding({ file: '/abs/src/x.ts', line: 1 });
      buildThreadEntry({ finding, controller, workspaceRoot: '/repo' });
      const [uri] = createCommentThread.mock.calls[0];
      expect((uri as { fsPath: string }).fsPath).toBe('/abs/src/x.ts');
    });
  });

  describe('thread metadata', () => {
    it('labels auto-review critical unresolved correctly', () => {
      const { controller, lastThread } = makeFakeController();
      buildThreadEntry({
        finding: makeFinding({
          status: 'unresolved',
          sourceKind: 'auto-review',
          severity: 'critical',
        }),
        controller,
        workspaceRoot: '/repo',
      });
      expect(lastThread().label).toBe('[unresolved] critical · auto-review');
    });

    it('labels reviewer deferred important with @login', () => {
      const { controller, lastThread } = makeFakeController();
      buildThreadEntry({
        finding: makeFinding({
          status: 'deferred',
          sourceKind: 'reviewer',
          login: 'alice',
          severity: 'important',
        }),
        controller,
        workspaceRoot: '/repo',
      });
      expect(lastThread().label).toBe('[deferred] important · @alice');
    });

    it('sets canReply true for every status (reply auto-promotes status)', () => {
      const statuses: StatusMarker[] = [
        'unresolved',
        'deferred',
        'resolved',
        'skipped',
        'custom',
      ];
      for (const status of statuses) {
        const { controller, lastThread } = makeFakeController();
        buildThreadEntry({
          finding: makeFinding({ status }),
          controller,
          workspaceRoot: '/repo',
        });
        expect(lastThread().canReply).toBe(true);
      }
    });
  });

  describe('per-status styling', () => {
    const statuses: ReadonlyArray<{
      status: StatusMarker;
      contextValue: string;
      threadState: vscode.CommentThreadState;
      collapsible: vscode.CommentThreadCollapsibleState;
      canReply: boolean;
    }> = [
      {
        status: 'unresolved',
        contextValue: 'review-finding-unresolved',
        threadState: vscode.CommentThreadState.Unresolved,
        collapsible: vscode.CommentThreadCollapsibleState.Expanded,
        canReply: true,
      },
      {
        status: 'deferred',
        contextValue: 'review-finding-deferred',
        threadState: vscode.CommentThreadState.Unresolved,
        collapsible: vscode.CommentThreadCollapsibleState.Expanded,
        canReply: true,
      },
      {
        status: 'resolved',
        contextValue: 'review-finding-resolved',
        threadState: vscode.CommentThreadState.Resolved,
        collapsible: vscode.CommentThreadCollapsibleState.Collapsed,
        canReply: true,
      },
      {
        status: 'skipped',
        contextValue: 'review-finding-skipped',
        threadState: vscode.CommentThreadState.Resolved,
        collapsible: vscode.CommentThreadCollapsibleState.Collapsed,
        canReply: true,
      },
      {
        status: 'custom',
        contextValue: 'review-finding-custom',
        threadState: vscode.CommentThreadState.Resolved,
        collapsible: vscode.CommentThreadCollapsibleState.Collapsed,
        canReply: true,
      },
    ];

    for (const variant of statuses) {
      it(`maps status ${variant.status} → contextValue/state/collapsibleState/canReply`, () => {
        const { controller, lastThread } = makeFakeController();
        buildThreadEntry({
          finding: makeFinding({ status: variant.status }),
          controller,
          workspaceRoot: '/repo',
        });
        expect(lastThread().contextValue).toBe(variant.contextValue);
        expect(lastThread().state).toBe(variant.threadState);
        expect(lastThread().collapsibleState).toBe(variant.collapsible);
        expect(lastThread().canReply).toBe(variant.canReply);
      });
    }

    it('suffixes -chatting when a deferred finding loads with persisted chat', () => {
      const { controller, lastThread } = makeFakeController();
      buildThreadEntry({
        finding: makeFinding({
          status: 'deferred',
          chat: [{ role: 'user', content: 'why two links?' }],
        }),
        controller,
        workspaceRoot: '/repo',
      });
      expect(lastThread().contextValue).toBe('review-finding-deferred-chatting');
    });

    it('does not suffix -chatting for non-deferred statuses with chat', () => {
      const { controller, lastThread } = makeFakeController();
      buildThreadEntry({
        finding: makeFinding({
          status: 'unresolved',
          chat: [{ role: 'user', content: 'hi' }],
        }),
        controller,
        workspaceRoot: '/repo',
      });
      expect(lastThread().contextValue).toBe('review-finding-unresolved');
    });
  });

  describe('comment body composition', () => {
    it('contains Comment / Analysis / Recommendation / Options sections as MarkdownString', () => {
      const { controller, lastThread } = makeFakeController();
      buildThreadEntry({
        finding: makeFinding({
          comment: 'C1',
          analysis: 'A1',
          recommendation: 'R1',
          options: ['opt one', 'opt two'],
        }),
        controller,
        workspaceRoot: '/repo',
      });
      const comments = lastThread().comments;
      expect(comments.length).toBe(1);
      const [body] = comments;
      expect(body.body).toBeInstanceOf(vscode.MarkdownString);
      const md = body.body as vscode.MarkdownString;
      expect(md.value).toContain('**Comment:** C1');
      expect(md.value).toContain('**Analysis:** A1');
      expect(md.value).toContain('**Recommendation:** R1');
      expect(md.value).toContain('**Options:**');
      expect(md.value).toContain('- opt one');
      expect(md.value).toContain('- opt two');
      expect(md.isTrusted).toBe(false);
      expect(md.supportHtml).toBe(false);
      expect(md.supportThemeIcons).toBe(true);
    });

    it('omits Options block when options array is empty', () => {
      const { controller, lastThread } = makeFakeController();
      buildThreadEntry({
        finding: makeFinding({ options: [] }),
        controller,
        workspaceRoot: '/repo',
      });
      const md = lastThread().comments[0].body as vscode.MarkdownString;
      expect(md.value).not.toContain('**Options:**');
    });

    it('omits Resolution block (deferred)', () => {
      const { controller, lastThread } = makeFakeController();
      buildThreadEntry({
        finding: makeFinding({ status: 'resolved', resolution: 'done' }),
        controller,
        workspaceRoot: '/repo',
      });
      const md = lastThread().comments[0].body as vscode.MarkdownString;
      expect(md.value).not.toContain('**Resolution:**');
      expect(md.value).not.toContain('done');
    });

    it('uses preview mode for the comment', () => {
      const { controller, lastThread } = makeFakeController();
      buildThreadEntry({
        finding: makeFinding(),
        controller,
        workspaceRoot: '/repo',
      });
      expect(lastThread().comments[0].mode).toBe(vscode.CommentMode.Preview);
    });

    it('sets comment contextValue to review-finding-comment', () => {
      const { controller, lastThread } = makeFakeController();
      buildThreadEntry({
        finding: makeFinding(),
        controller,
        workspaceRoot: '/repo',
      });
      expect(lastThread().comments[0].contextValue).toBe('review-finding-comment');
    });

    it('sets comment author.name to the source label for auto-review', () => {
      const { controller, lastThread } = makeFakeController();
      buildThreadEntry({
        finding: makeFinding({ sourceKind: 'auto-review' }),
        controller,
        workspaceRoot: '/repo',
      });
      expect(lastThread().comments[0].author.name).toBe('auto-review');
    });

    it('sets comment author.name to @login for reviewer source', () => {
      const { controller, lastThread } = makeFakeController();
      buildThreadEntry({
        finding: makeFinding({ sourceKind: 'reviewer', login: 'bob' }),
        controller,
        workspaceRoot: '/repo',
      });
      expect(lastThread().comments[0].author.name).toBe('@bob');
    });
  });

  describe('pretty styling', () => {
    it('leaves author iconPath undefined when persona icons are not configured', () => {
      clearPersonaIcons();
      const { controller, lastThread } = makeFakeController();
      buildThreadEntry({
        finding: makeFinding({ sourceKind: 'auto-review' }),
        controller,
        workspaceRoot: '/repo',
      });
      expect(lastThread().comments[0].author.iconPath).toBeUndefined();
    });

    it('uses the auto-review persona icon when configured', () => {
      const icons: PersonaIcons = {
        autoReview: vscode.Uri.file('/ext/media/avatar-auto-review.svg'),
        user: vscode.Uri.file('/ext/media/avatar-user.svg'),
        agent: vscode.Uri.file('/ext/media/avatar-agent.svg'),
      };
      setPersonaIcons(icons);
      try {
        const { controller, lastThread } = makeFakeController();
        buildThreadEntry({
          finding: makeFinding({ sourceKind: 'auto-review' }),
          controller,
          workspaceRoot: '/repo',
        });
        expect(lastThread().comments[0].author.iconPath).toBe(icons.autoReview);
      } finally {
        clearPersonaIcons();
      }
    });

    it('uses the GitHub avatar URL for a reviewer regardless of persona icons', () => {
      clearPersonaIcons();
      const { controller, lastThread } = makeFakeController();
      buildThreadEntry({
        finding: makeFinding({ sourceKind: 'reviewer', login: 'alice' }),
        controller,
        workspaceRoot: '/repo',
      });
      const iconPath = lastThread().comments[0].author.iconPath as vscode.Uri;
      expect(iconPath.toString()).toBe('https://github.com/alice.png?size=48');
    });

    describe('iconForSource — cached round avatar hit', () => {
      beforeEach(() => clearAvatarCache());
      afterEach(() => { vi.unstubAllGlobals(); });

      it('uses the cached circular avatar URI when cachedRoundAvatar is populated', async () => {
        const PNG_BYTES = Uint8Array.from([137, 80, 78, 71, 1, 2, 3, 4]);
        vi.stubGlobal('fetch', vi.fn(async () => ({
          ok: true,
          status: 200,
          arrayBuffer: async () => PNG_BYTES.buffer.slice(0),
        })));
        await ensureRoundAvatar('alice');
        const cachedUri = cachedRoundAvatar('alice');
        expect(cachedUri).toBeDefined();

        const { controller, lastThread } = makeFakeController();
        buildThreadEntry({
          finding: makeFinding({ sourceKind: 'reviewer', login: 'alice' }),
          controller,
          workspaceRoot: '/repo',
        });

        expect(lastThread().comments[0].author.iconPath).toBe(cachedUri);
      });
    });

    it('sets comment label to the severity', () => {
      const { controller, lastThread } = makeFakeController();
      buildThreadEntry({
        finding: makeFinding({ severity: 'important' }),
        controller,
        workspaceRoot: '/repo',
      });
      expect(lastThread().comments[0].label).toBe('important');
    });

    it('prefixes body sections with codicons matching severity', () => {
      const { controller, lastThread } = makeFakeController();
      buildThreadEntry({
        finding: makeFinding({ severity: 'critical' }),
        controller,
        workspaceRoot: '/repo',
      });
      const md = lastThread().comments[0].body as vscode.MarkdownString;
      expect(md.value).toContain('$(error) **Comment:**');
      expect(md.value).toContain('$(search) **Analysis:**');
      expect(md.value).toContain('$(lightbulb) **Recommendation:**');
      expect(md.value).toContain('$(list-unordered) **Options:**');
    });

    it('uses warning codicon for important severity', () => {
      const { controller, lastThread } = makeFakeController();
      buildThreadEntry({
        finding: makeFinding({ severity: 'important' }),
        controller,
        workspaceRoot: '/repo',
      });
      const md = lastThread().comments[0].body as vscode.MarkdownString;
      expect(md.value).toContain('$(warning) **Comment:**');
    });

    it('uses info codicon for nit severity', () => {
      const { controller, lastThread } = makeFakeController();
      buildThreadEntry({
        finding: makeFinding({ severity: 'nit' }),
        controller,
        workspaceRoot: '/repo',
      });
      const md = lastThread().comments[0].body as vscode.MarkdownString;
      expect(md.value).toContain('$(info) **Comment:**');
    });
  });

  describe('chat seeding', () => {
    it('appends persisted chat messages after the finding comment on initial build', () => {
      const { controller, lastThread } = makeFakeController();
      buildThreadEntry({
        finding: makeFinding({
          status: 'deferred',
          chat: [
            { role: 'user', content: 'hello?' },
            { role: 'assistant', content: 'hi back' },
          ],
        }),
        controller,
        workspaceRoot: '/repo',
      });
      const comments = lastThread().comments;
      expect(comments).toHaveLength(3);
      expect(comments[0].contextValue).toBe('review-finding-comment');
      expect(comments[1].contextValue).toBe('review-chat-user');
      expect((comments[1].body as vscode.MarkdownString).value).toBe('hello?');
      expect(comments[2].contextValue).toBe('review-chat-assistant');
      expect((comments[2].body as vscode.MarkdownString).value).toBe('hi back');
      expect(comments[2].author.name).toBe('Review Agent');
    });

    it('leaves a single finding comment when finding has no chat', () => {
      const { controller, lastThread } = makeFakeController();
      buildThreadEntry({
        finding: makeFinding({ status: 'deferred' }),
        controller,
        workspaceRoot: '/repo',
      });
      expect(lastThread().comments).toHaveLength(1);
    });
  });

  describe('id and item propagation', () => {
    it('returns thread+id+item for a file-anchored finding', () => {
      const { controller } = makeFakeController();
      const finding = withId(makeFinding({ file: 'src/x.ts', line: 3 }), 'uuid-1');
      const result = buildThreadEntry({ finding, controller, workspaceRoot: '/repo' });
      expect(result).not.toBeNull();
      if (result === null) {throw new Error('expected entry');}
      expect(result.id).toBe('uuid-1');
      expect(result.item).toBe(finding);
      expect(result.thread).toBeDefined();
    });

    it('returns null when the finding is review-body anchored', () => {
      const { controller } = makeFakeController();
      const finding = withId(makeFinding({ locationKind: 'review-body' }), 'uuid-2');
      const result = buildThreadEntry({ finding, controller, workspaceRoot: '/repo' });
      expect(result).toBeNull();
    });

    it('carries the finding id onto the built entry verbatim', () => {
      const { controller } = makeFakeController();
      const finding = withId(makeFinding(), 'the-stable-id');
      const result = buildThreadEntry({ finding, controller, workspaceRoot: '/repo' });
      expect(result?.id).toBe('the-stable-id');
    });
  });
});
