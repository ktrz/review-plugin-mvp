import type { ChatMessage, HandoverDocument, FindingItem, StatusMarker } from './types';

const STATUS_TO_DISK: Record<StatusMarker, string> = {
  unresolved: '?',
  resolved: 'x',
  custom: '~',
  deferred: 'd',
  skipped: '-',
};

function computeSourceCounts(items: FindingItem[]): string {
  const autoCount = items.filter(it => it.source.kind === 'auto-review').length;
  const humanCount = items.filter(it => it.source.kind === 'reviewer').length;
  const critCount = items.filter(it => it.source.severity === 'critical').length;
  const impCount = items.filter(it => it.source.severity === 'important').length;
  const sugNitCount = items.filter(it =>
    it.source.severity === 'suggestion' || it.source.severity === 'nit'
  ).length;
  return (
    `${autoCount} auto-review findings, ` +
    `${humanCount} human reviewer comments, ` +
    `${items.length} total ` +
    `(${critCount} critical, ${impCount} important, ${sugNitCount} suggestion/nit)`
  );
}

function serializeHeader(header: HandoverDocument['header'], items: FindingItem[]): string {
  const lines: string[] = [];
  lines.push(`# PR Review Handover: #${header.prNumber}`);
  lines.push('');
  lines.push(`**PR:** ${header.prUrl}`);
  lines.push(`**Branch:** ${header.branch.head.ref} → ${header.branch.base.ref}`);
  if (header.branch.head.sha !== undefined) {
    lines.push(`**Head SHA:** ${header.branch.head.sha}`);
  }
  if (header.branch.base.sha !== undefined) {
    lines.push(`**Base SHA:** ${header.branch.base.sha}`);
  }
  lines.push(`**Generated:** ${header.generatedAt}`);
  lines.push(`**Status:** ${header.status}`);
  lines.push(`**Source counts:** ${computeSourceCounts(items)}`);
  return lines.join('\n');
}

function renderItemHeading(item: FindingItem): string {
  const markerChar = STATUS_TO_DISK[item.status];
  if (!markerChar) {
    throw new Error(`Unknown StatusMarker: '${item.status}'`);
  }
  const sourceTag =
    item.source.kind === 'auto-review'
      ? `auto:${item.source.severity}`
      : `reviewer:@${item.source.login}`;
  const location =
    item.location.kind === 'file'
      ? `${item.location.file}:${item.location.line}`
      : 'review body';
  return `## [${markerChar}] ${sourceTag} — ${location}`;
}

function renderComment(item: FindingItem): string {
  const source = item.source.kind === 'reviewer' ? 'github_pr_comment' : 'auto_review_finding';
  return `**Comment:**\n\n<external_data source="${source}" trust="untrusted">\n${item.comment}\n</external_data>`;
}

function renderChatBlock(chat: ChatMessage[], lines: string[]): void {
  lines.push('**Chat:**');
  for (const msg of chat) {
    const contentLines = msg.content.split('\n');
    lines.push(`- ${msg.role}: ${contentLines[0]}`);
    for (let i = 1; i < contentLines.length; i++) {
      lines.push(`  ${contentLines[i]}`);
    }
  }
}

function renderItem(item: FindingItem): string {
  const lines: string[] = [];
  lines.push(renderItemHeading(item));
  lines.push('');
  lines.push(`**Severity:** ${item.source.severity}`);
  lines.push(`**Source:** ${item.source.kind}`);
  lines.push(`**Reported by:** ${item.reportedBy.join(', ')}`);
  lines.push(`**Id:** ${item.id}`);
  lines.push(renderComment(item));
  lines.push(`**Analysis:** ${item.analysis}`);
  lines.push(`**Recommendation:** ${item.recommendation}`);
  lines.push('**Options:**');
  for (const opt of item.options) {
    lines.push(`- ${opt}`);
  }
  if (item.chat !== undefined && item.chat.length > 0) {
    renderChatBlock(item.chat, lines);
  }
  lines.push(`**Resolution:** ${item.resolution}`);
  return lines.join('\n');
}

export function serializeDocument(doc: HandoverDocument): string {
  const parts: string[] = [];

  parts.push(serializeHeader(doc.header, doc.items));
  parts.push('');

  for (const item of doc.items) {
    parts.push('---');
    parts.push('');
    const itemText = item.dirty ? renderItem(item) : item.rawSource;
    parts.push(itemText);
    parts.push('');
  }

  return parts.join('\n');
}
