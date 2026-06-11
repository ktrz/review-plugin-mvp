import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { renderChat } from './chat-renderer';
import {
  clearPersonaIcons,
  setPersonaIcons,
  type PersonaIcons,
} from './persona-icons';
import type { ChatMessage, FindingItem } from '../schema';

const makeThread = (initialComments: vscode.Comment[] = []): vscode.CommentThread => {
  const fake: Partial<vscode.CommentThread> = {
    label: '[deferred] critical · auto-review',
    contextValue: 'review-finding-deferred',
    state: vscode.CommentThreadState.Unresolved,
    collapsibleState: vscode.CommentThreadCollapsibleState.Expanded,
    comments: initialComments,
  };
  return fake as vscode.CommentThread;
};

const makeFindingComment = (body = 'finding body'): vscode.Comment => {
  const fake: Partial<vscode.Comment> = {
    body,
    mode: vscode.CommentMode.Preview,
    author: { name: 'auto-review' },
    contextValue: 'review-finding-comment',
  };
  return fake as vscode.Comment;
};

const makeItem = (
  overrides: Partial<FindingItem> = {},
): FindingItem => {
  const base: FindingItem = {
    id: 'F-001',
    dirty: false,
    rawSource: 'raw',
    status: 'deferred',
    source: { kind: 'auto-review', severity: 'critical' },
    location: { kind: 'file', file: 'src/a.ts', line: 1 },
    reportedBy: ['auto-review'],
    comment: 'c',
    analysis: 'a',
    recommendation: 'r',
    options: [],
    resolution: '',
  };
  return { ...base, ...overrides } satisfies FindingItem;
};

describe('renderChat', () => {
  describe('no chat', () => {
    it('leaves the thread with a single finding comment', () => {
      const findingComment = makeFindingComment();
      const thread = makeThread([findingComment]);
      const getAuthorLabel = vi.fn(() => 'You');

      renderChat(thread, makeItem({ chat: undefined }), { getAuthorLabel });

      expect(thread.comments).toHaveLength(1);
      expect(thread.comments[0]).toBe(findingComment);
      expect(getAuthorLabel).not.toHaveBeenCalled();
    });

    it('treats an empty chat array the same as undefined', () => {
      const findingComment = makeFindingComment();
      const thread = makeThread([findingComment]);
      const getAuthorLabel = vi.fn(() => 'You');

      renderChat(thread, makeItem({ chat: [] }), { getAuthorLabel });

      expect(thread.comments).toHaveLength(1);
      expect(thread.comments[0]).toBe(findingComment);
    });

    it('still re-assigns thread.comments (new array identity)', () => {
      const findingComment = makeFindingComment();
      const thread = makeThread([findingComment]);
      const original = thread.comments;

      renderChat(thread, makeItem({ chat: undefined }), {
        getAuthorLabel: () => 'You',
      });

      expect(thread.comments).not.toBe(original);
    });
  });

  describe('with chat messages', () => {
    it('appends one comment per chat message after the finding comment', () => {
      const findingComment = makeFindingComment();
      const thread = makeThread([findingComment]);
      const chat: ChatMessage[] = [
        { role: 'user', content: 'why?' },
        { role: 'assistant', content: 'because' },
        { role: 'user', content: 'ok' },
      ];

      renderChat(thread, makeItem({ chat }), { getAuthorLabel: () => 'Chris' });

      expect(thread.comments).toHaveLength(4);
      expect(thread.comments[0]).toBe(findingComment);
    });

    it('labels user messages via getAuthorLabel and assistant messages as Review Agent', () => {
      const findingComment = makeFindingComment();
      const thread = makeThread([findingComment]);
      const chat: ChatMessage[] = [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ];

      renderChat(thread, makeItem({ chat }), { getAuthorLabel: () => 'Chris' });

      const [, userComment, agentComment] = thread.comments;
      expect(userComment.author.name).toBe('Chris');
      expect(agentComment.author.name).toBe('Review Agent');
    });

    it('leaves iconPath undefined when persona icons are not configured', () => {
      clearPersonaIcons();
      const findingComment = makeFindingComment();
      const thread = makeThread([findingComment]);
      const chat: ChatMessage[] = [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ];

      renderChat(thread, makeItem({ chat }), { getAuthorLabel: () => 'Chris' });

      expect(thread.comments[1].author.iconPath).toBeUndefined();
      expect(thread.comments[2].author.iconPath).toBeUndefined();
    });

    it('uses persona icons for user and agent when configured', () => {
      const icons: PersonaIcons = {
        autoReview: vscode.Uri.file('/ext/media/avatar-auto-review.svg'),
        reviewer: vscode.Uri.file('/ext/media/avatar-reviewer.svg'),
        user: vscode.Uri.file('/ext/media/avatar-user.svg'),
        agent: vscode.Uri.file('/ext/media/avatar-agent.svg'),
      };
      setPersonaIcons(icons);
      try {
        const findingComment = makeFindingComment();
        const thread = makeThread([findingComment]);
        const chat: ChatMessage[] = [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ];

        renderChat(thread, makeItem({ chat }), { getAuthorLabel: () => 'Chris' });

        expect(thread.comments[1].author.iconPath).toBe(icons.user);
        expect(thread.comments[2].author.iconPath).toBe(icons.agent);
      } finally {
        clearPersonaIcons();
      }
    });

    it('enables supportThemeIcons on chat body markdown', () => {
      const findingComment = makeFindingComment();
      const thread = makeThread([findingComment]);
      const chat: ChatMessage[] = [{ role: 'user', content: 'hi' }];

      renderChat(thread, makeItem({ chat }), { getAuthorLabel: () => 'Chris' });

      const body = thread.comments[1].body as vscode.MarkdownString;
      expect(body.supportThemeIcons).toBe(true);
    });

    it('falls back to "You" when getAuthorLabel returns undefined', () => {
      const findingComment = makeFindingComment();
      const thread = makeThread([findingComment]);
      const chat: ChatMessage[] = [{ role: 'user', content: 'hi' }];

      renderChat(thread, makeItem({ chat }), { getAuthorLabel: () => undefined });

      expect(thread.comments[1].author.name).toBe('You');
    });

    it('renders chat comments in Preview mode with the message content as the body', () => {
      const findingComment = makeFindingComment();
      const thread = makeThread([findingComment]);
      const chat: ChatMessage[] = [
        { role: 'user', content: 'why is this risky?' },
        { role: 'assistant', content: 'because of X' },
      ];

      renderChat(thread, makeItem({ chat }), { getAuthorLabel: () => 'Chris' });

      const userComment = thread.comments[1];
      const agentComment = thread.comments[2];
      expect(userComment.mode).toBe(vscode.CommentMode.Preview);
      expect(agentComment.mode).toBe(vscode.CommentMode.Preview);
      expect(stringifyBody(userComment.body)).toBe('why is this risky?');
      expect(stringifyBody(agentComment.body)).toBe('because of X');
    });

    it('preserves the existing finding comment as element 0 (does not replace it)', () => {
      const findingComment = makeFindingComment('original-body');
      const thread = makeThread([findingComment]);
      const chat: ChatMessage[] = [{ role: 'user', content: 'q' }];

      renderChat(thread, makeItem({ chat }), { getAuthorLabel: () => 'Chris' });

      expect(thread.comments[0]).toBe(findingComment);
    });

    it('does not mutate label / contextValue / state / collapsibleState set by refreshThread', () => {
      const findingComment = makeFindingComment();
      const thread = makeThread([findingComment]);
      thread.label = '[d] critical · auto-review';
      thread.contextValue = 'review-finding-deferred-chatting';
      thread.state = vscode.CommentThreadState.Unresolved;
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;

      renderChat(thread, makeItem({ chat: [{ role: 'user', content: 'q' }] }), {
        getAuthorLabel: () => 'Chris',
      });

      expect(thread.label).toBe('[d] critical · auto-review');
      expect(thread.contextValue).toBe('review-finding-deferred-chatting');
      expect(thread.state).toBe(vscode.CommentThreadState.Unresolved);
      expect(thread.collapsibleState).toBe(vscode.CommentThreadCollapsibleState.Expanded);
    });

    it('re-assigns thread.comments (new array identity, not mutation)', () => {
      const findingComment = makeFindingComment();
      const thread = makeThread([findingComment]);
      const original = thread.comments;

      renderChat(thread, makeItem({ chat: [{ role: 'user', content: 'q' }] }), {
        getAuthorLabel: () => 'Chris',
      });

      expect(thread.comments).not.toBe(original);
    });
  });

  describe('empty initial thread.comments', () => {
    it('throws when the thread has no finding comment to anchor on', () => {
      const thread = makeThread([]);
      expect(() =>
        renderChat(thread, makeItem({ chat: [{ role: 'user', content: 'q' }] }), {
          getAuthorLabel: () => 'Chris',
        }),
      ).toThrow(/finding comment/i);
    });
  });
});

function stringifyBody(body: vscode.Comment['body']): string {
  if (typeof body === 'string') {
    return body;
  }
  return body.value;
}
