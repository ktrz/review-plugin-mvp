import path from 'node:path';
import * as vscode from 'vscode';
import type { FindingItem, Source, StatusMarker } from '../schema';

export interface BuildThreadDeps {
  finding: FindingItem;
  controller: vscode.CommentController;
  workspaceRoot: string;
}

export interface BuildThreadEntryDeps {
  finding: FindingItemWithId;
  controller: vscode.CommentController;
  workspaceRoot: string;
}

export type FindingItemWithId = FindingItem & { id: string };

export interface ThreadEntry {
  thread: vscode.CommentThread;
  id: string;
  item: FindingItemWithId;
}

export function buildThread(deps: BuildThreadDeps): vscode.CommentThread | null {
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
    author: { name: sourceLabel },
    contextValue: 'review-finding-comment',
  };

  const thread = controller.createCommentThread(uri, range, [comment]);
  thread.label = `[${finding.status}] ${finding.source.severity} · ${sourceLabel}`;
  thread.contextValue = contextValueForStatus(finding.status);
  thread.canReply = false;
  thread.collapsibleState = collapsibleStateForStatus(finding.status);
  thread.state = threadStateForStatus(finding.status);
  return thread;
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
  const parts: string[] = [
    `**Comment:** ${finding.comment}`,
    `**Analysis:** ${finding.analysis}`,
    `**Recommendation:** ${finding.recommendation}`,
  ];
  if (finding.options.length > 0) {
    const bullets = finding.options.map((opt) => `- ${opt}`).join('\n');
    parts.push(`**Options:**\n${bullets}`);
  }
  const md = new vscode.MarkdownString(parts.join('\n\n'));
  md.isTrusted = false;
  md.supportHtml = false;
  return md;
}
