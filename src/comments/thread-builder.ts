import path from 'node:path';
import * as vscode from 'vscode';
import type { FindingItem, Severity, Source } from '../schema';

export interface BuildThreadDeps {
  finding: FindingItem;
  controller: vscode.CommentController;
  workspaceRoot: string;
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
  thread.contextValue = 'review-finding';
  thread.canReply = false;
  thread.collapsibleState = collapsibleStateFor(finding.source.severity);
  return thread;
}

function formatSourceLabel(source: Source): string {
  if (source.kind === 'auto-review') {
    return 'auto-review';
  }
  return `@${source.login}`;
}

function collapsibleStateFor(severity: Severity): vscode.CommentThreadCollapsibleState {
  if (severity === 'critical' || severity === 'important') {
    return vscode.CommentThreadCollapsibleState.Expanded;
  }
  return vscode.CommentThreadCollapsibleState.Collapsed;
}

function composeBody(finding: FindingItem): vscode.MarkdownString {
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
