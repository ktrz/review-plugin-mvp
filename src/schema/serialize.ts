import type { HandoverDocument, FindingItem, DocumentHeader } from './types';

// ---------------------------------------------------------------------------
// Header serialization
// ---------------------------------------------------------------------------

function serializeHeader(header: DocumentHeader): string {
  const lines: string[] = [];
  lines.push(`# PR Review Handover: #${extractPrNumber(header.prUrl)}`);
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
  lines.push(`**Source counts:** ${serializeSourceCounts(header)}`);
  return lines.join('\n');
}

function extractPrNumber(prUrl: string): string {
  const m = prUrl.match(/\/pull\/(\d+)$/);
  return m ? m[1] : '?';
}

function serializeSourceCounts(header: DocumentHeader): string {
  const c = header.sourceCounts;
  return (
    `${c.autoReviewFindings} auto-review findings, ` +
    `${c.humanReviewerComments} human reviewer comments, ` +
    `${c.totalItems} total ` +
    `(${c.totalCritical} critical, ${c.totalImportant} important, ${c.totalSuggestionOrNit} suggestion/nit)`
  );
}

// ---------------------------------------------------------------------------
// Item rendering
// ---------------------------------------------------------------------------

function renderItemHeading(item: FindingItem): string {
  const markerInner = item.status.slice(1, -1); // '[?]' → '?'
  const sourceTag =
    item.source.kind === 'auto-review'
      ? `auto:${item.severity}`
      : `reviewer:${item.source.login}`;
  const location =
    item.file !== null && item.line !== null ? `${item.file}:${item.line}` : 'review body';
  return `## [${markerInner}] ${sourceTag} — ${location}`;
}

function renderItem(item: FindingItem): string {
  const lines: string[] = [];
  lines.push(renderItemHeading(item));
  lines.push('');
  lines.push(`**Severity:** ${item.severity}`);
  lines.push(
    `**Source:** ${item.source.kind === 'auto-review' ? 'auto-review' : 'reviewer'}`,
  );
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

  parts.push(serializeHeader(doc.header));
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
