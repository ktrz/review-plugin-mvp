import * as vscode from 'vscode';
import type { ChatMessage, FindingItem } from '../schema';
import { personaIconPath } from './persona-icons';

export interface RenderChatDeps {
  getAuthorLabel: () => string | undefined;
}

export class ChatRendererError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatRendererError';
  }
}

export function renderChat(
  thread: vscode.CommentThread,
  item: FindingItem,
  deps: RenderChatDeps,
): void {
  const findingComment = thread.comments[0];
  const chat = item.chat ?? [];

  if (chat.length === 0) {
    thread.comments = findingComment === undefined ? [] : [findingComment];
    return;
  }

  if (findingComment === undefined) {
    throw new ChatRendererError(
      `renderChat: thread for finding ${item.id} has no finding comment to anchor on`,
    );
  }

  const userLabel = deps.getAuthorLabel() ?? 'You';
  const chatComments = chat.map((message) => toComment(message, userLabel));
  thread.comments = [findingComment, ...chatComments];
}

function toComment(message: ChatMessage, userLabel: string): vscode.Comment {
  const isAssistant = message.role === 'assistant';
  const authorName = isAssistant ? 'Review Agent' : userLabel;
  const iconPath = personaIconPath(isAssistant ? 'agent' : 'user');
  const body = new vscode.MarkdownString(message.content);
  body.supportThemeIcons = true;
  return {
    body,
    mode: vscode.CommentMode.Preview,
    author: { name: authorName, iconPath },
    contextValue: `review-chat-${message.role}`,
  };
}
