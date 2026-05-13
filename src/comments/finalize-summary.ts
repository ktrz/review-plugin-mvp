import type { FindingItem, StatusMarker } from '../schema';

export type StatusCounts = {
  resolved: number;
  custom: number;
  deferred: number;
  skipped: number;
  unresolved: number;
};

export class UnknownStatusError extends Error {
  readonly status: string;
  constructor(status: string) {
    super(`Unknown finding status: ${status}`);
    this.name = 'UnknownStatusError';
    this.status = status;
  }
}

export function countByStatus(items: ReadonlyArray<FindingItem>): StatusCounts {
  const counts: StatusCounts = {
    resolved: 0,
    custom: 0,
    deferred: 0,
    skipped: 0,
    unresolved: 0,
  };
  for (const item of items) {
    const status: StatusMarker = item.status;
    switch (status) {
      case 'resolved':
        counts.resolved += 1;
        break;
      case 'custom':
        counts.custom += 1;
        break;
      case 'deferred':
        counts.deferred += 1;
        break;
      case 'skipped':
        counts.skipped += 1;
        break;
      case 'unresolved':
        counts.unresolved += 1;
        break;
      default: {
        const _exhaustive: never = status;
        void _exhaustive;
        throw new UnknownStatusError(String(status));
      }
    }
  }
  return counts;
}

export type RenderedSummary = {
  line: string;
  block: string;
  cliCommand: string;
};

export function renderSummary(input: { filePath: string; counts: StatusCounts }): RenderedSummary {
  const { filePath, counts } = input;
  const total = counts.resolved + counts.custom + counts.deferred + counts.skipped + counts.unresolved;
  const cliCommand = `claude /execute-review-decisions ${filePath}`;

  const block = [
    `Review session — ${total} items`,
    `  resolved:   ${counts.resolved}  [x]`,
    `  custom:     ${counts.custom}  [~]`,
    `  deferred:   ${counts.deferred}  [d]`,
    `  skipped:    ${counts.skipped}  [-]`,
    `  unresolved: ${counts.unresolved}  [?]`,
    '',
    `File:    ${filePath}`,
    `Command: ${cliCommand}`,
  ].join('\n');

  const line = renderLine({ total, unresolved: counts.unresolved, deferred: counts.deferred });

  return { line, block, cliCommand };
}

function renderLine(input: { total: number; unresolved: number; deferred: number }): string {
  const { total, unresolved, deferred } = input;
  if (total === 0) {
    return 'Review session: 0 items.';
  }
  const incomplete = unresolved + deferred;
  if (incomplete > 0) {
    return `${incomplete} items still need attention (${unresolved} unresolved, ${deferred} deferred) — finalize anyway?`;
  }
  return `Review session complete: ${total} items all addressed.`;
}
