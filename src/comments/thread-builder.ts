import path from 'node:path';
import * as vscode from 'vscode';
import type { FindingItem, Severity, Source, StatusMarker } from '../schema';
import { renderChat } from './chat-renderer';
import { cachedRoundAvatar, githubAvatarUri } from './avatar-cache';
import { getPersonaIcons } from './persona-icons';

interface BuildThreadDeps {
  finding: FindingItem;
  controller: vscode.CommentController;
  workspaceRoot: string;
}

export interface BuildThreadEntryDeps {
  finding: FindingItem;
  controller: vscode.CommentController;
  workspaceRoot: string;
}

export interface ThreadEntry {
  thread: vscode.CommentThread;
  id: string;
  item: FindingItem;
}

function buildThread(deps: BuildThreadDeps): vscode.CommentThread | null {
  const { finding, controller, workspaceRoot } = deps;
  if (finding.location.kind !== 'file') {
    return null;
  }

  const uri = vscode.Uri.file(path.resolve(workspaceRoot, finding.location.file));
  const lineIndex = finding.location.line - 1;
  const range = new vscode.Range(lineIndex, 0, lineIndex, 0);

  const sourceLabel = formatSourceLabel(finding.source);
  const body = composeBody(finding);
  const comment: vscode.Comment = {
    body,
    mode: vscode.CommentMode.Preview,
    author: {
      name: sourceLabel,
      iconPath: iconForSource(finding.source),
    },
    label: finding.source.severity,
    contextValue: 'review-finding-comment',
  };

  const thread = controller.createCommentThread(uri, range, [comment]);
  thread.label = `[${finding.status}] ${finding.source.severity} · ${sourceLabel}`;
  thread.contextValue = contextValueForFinding(finding);
  thread.canReply = canReplyForStatus(finding.status);
  thread.collapsibleState = collapsibleStateForStatus(finding.status);
  thread.state = threadStateForStatus(finding.status);
  if ((finding.chat?.length ?? 0) > 0) {
    renderChat(thread, finding, { getAuthorLabel: () => undefined });
  }
  return thread;
}

export function canReplyForStatus(_status: StatusMarker): boolean {
  return true;
}

export function buildThreadEntry(deps: BuildThreadEntryDeps): ThreadEntry | null {
  const thread = buildThread({
    finding: deps.finding,
    controller: deps.controller,
    workspaceRoot: deps.workspaceRoot,
  });
  if (thread === null) {
    return null;
  }
  return { thread, id: deps.finding.id, item: deps.finding };
}

export function contextValueForStatus(status: StatusMarker): string {
  return `review-finding-${status}`;
}

export function contextValueForFinding(finding: FindingItem): string {
  const base = contextValueForStatus(finding.status);
  if (finding.status === 'deferred' && (finding.chat?.length ?? 0) > 0) {
    return `${base}-chatting`;
  }
  return base;
}

export function threadStateForStatus(status: StatusMarker): vscode.CommentThreadState {
  if (status === 'unresolved' || status === 'deferred') {
    return vscode.CommentThreadState.Unresolved;
  }
  return vscode.CommentThreadState.Resolved;
}

export function collapsibleStateForStatus(
  status: StatusMarker,
): vscode.CommentThreadCollapsibleState {
  if (status === 'unresolved' || status === 'deferred') {
    return vscode.CommentThreadCollapsibleState.Expanded;
  }
  return vscode.CommentThreadCollapsibleState.Collapsed;
}

export function formatSourceLabel(source: Source): string {
  if (source.kind === 'auto-review') {
    return 'auto-review';
  }
  return `@${source.login}`;
}

export function composeBody(finding: FindingItem): vscode.MarkdownString {
  const severityIcon = codiconForSeverity(finding.source.severity);
  const parts: string[] = [
    `$(${severityIcon}) **Comment:** ${finding.comment}`,
    `$(search) **Analysis:** ${finding.analysis}`,
    `$(lightbulb) **Recommendation:** ${finding.recommendation}`,
  ];
  if (finding.options.length > 0) {
    const bullets = finding.options.map((opt) => `- ${opt}`).join('\n');
    parts.push(`$(list-unordered) **Options:**\n${bullets}`);
  }
  const md = new vscode.MarkdownString(parts.join('\n\n'));
  md.isTrusted = false;
  md.supportHtml = false;
  md.supportThemeIcons = true;
  return md;
}

export function iconForSource(source: Source): vscode.Uri | undefined {
  if (source.kind === 'reviewer') {
    // Prefer the fetched circular avatar; until it lands, show the square
    // GitHub PNG (real photo or auto-generated identicon) so something renders.
    return cachedRoundAvatar(source.login) ?? githubAvatarUri(source.login);
  }
  const icons = getPersonaIcons();
  if (icons === undefined) {
    return undefined;
  }
  return icons.autoReview;
}

export function codiconForSeverity(severity: Severity): string {
  switch (severity) {
    case 'critical':
      return 'error';
    case 'important':
      return 'warning';
    case 'suggestion':
      return 'lightbulb';
    case 'nit':
      return 'info';
  }
}
