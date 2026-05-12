import type { HandoverDocument, FindingItem } from './types';

// Maps named-semantic StatusMarker to on-disk format (H1)
const STATUS_TO_DISK: Record<string, string> = {
  unresolved: '?',
  resolved: 'x',
  custom: '~',
  deferred: 'd',
  skipped: '-',
};

// ---------------------------------------------------------------------------
// Source counts (H9: derive from items)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Header serialization
// ---------------------------------------------------------------------------

function serializeHeader(header: HandoverDocument['header'], items: FindingItem[]): string {
  const lines: string[] = [];
  lines.push(`# PR Review Handover: #${header.prNumber}`);  // F1: use prNumber directly
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
  lines.push(`**Source counts:** ${computeSourceCounts(items)}`);  // H9: derived
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Item rendering
// ---------------------------------------------------------------------------

function renderItemHeading(item: FindingItem): string {
  const markerChar = STATUS_TO_DISK[item.status];  // H1
  const sourceTag =
    item.source.kind === 'auto-review'
      ? `auto:${item.source.severity}`   // G3: severity in source
      : `reviewer:@${item.source.login}`;  // H2: prepend @ for on-disk format
  // G2/F2: exhaustive branch on location.kind
  const location =
    item.location.kind === 'file'
      ? `${item.location.file}:${item.location.line}`
      : 'review body';
  return `## [${markerChar}] ${sourceTag} — ${location}`;
}

function renderItem(item: FindingItem): string {
  const lines: string[] = [];
  lines.push(renderItemHeading(item));
  lines.push('');
  lines.push(`**Severity:** ${item.source.severity}`);  // G3: severity in source
  lines.push(`**Source:** ${item.source.kind}`);  // F3: inline source.kind
  lines.push(`**Reported by:** ${item.reportedBy.join(', ')}`);
  lines.push(`**Comment:** ${item.comment}`);
  lines.push(`**Analysis:** ${item.analysis}`);
  lines.push(`**Recommendation:** ${item.recommendation}`);
  lines.push('**Options:**');
  for (const opt of item.options) {
    lines.push(`- ${opt}`);
  }
  lines.push(`**Resolution:** ${item.resolution}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Document serialization
// ---------------------------------------------------------------------------

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
