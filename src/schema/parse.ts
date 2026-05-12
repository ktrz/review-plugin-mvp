import {
  HandoverDocumentSchema,
  type HandoverDocument,
  type DocumentHeader,
  type FindingItem,
  type StatusMarker,
  type Source,
  type Severity,
} from './types';

// ---------------------------------------------------------------------------
// Parser state machine
// ---------------------------------------------------------------------------

export type ParserState =
  | 'IN_HEADER'
  | 'BETWEEN_ITEMS'
  | 'IN_ITEM_HEADING'
  | 'IN_ITEM_FIELDS'
  | 'IN_OPTIONS'
  | 'IN_RESOLUTION';

// ---------------------------------------------------------------------------
// ParseError
// ---------------------------------------------------------------------------

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly offset: number,
    public readonly state: ParserState,
    public readonly lineNumber: number,
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

// Matches item heading: ## [STATUS] SOURCE_TAG — FILE:LINE  or  — review body
// STATUS: one of ?, x, ~, d, -
// SOURCE_TAG: auto:SEVERITY  or  reviewer:@LOGIN
const ITEM_HEADING_RE =
  /^## \[([?x~d\-])\] (auto:([a-z]+)|reviewer:(@\S+)) — (review body|([^\s:]+):(\d+))$/;

// Matches **Key:** value  (colon is inside closing **)
const FIELD_RE = /^\*\*([^*]+):\*\*\s*(.*)/;

// ---------------------------------------------------------------------------
// Source counts parsing
// ---------------------------------------------------------------------------

function parseSourceCounts(line: string): DocumentHeader['sourceCounts'] | null {
  // "4 auto-review findings, 2 human reviewer comments, 6 total (1 critical, 2 important, 3 suggestion/nit)"
  const m = line.match(
    /(\d+) auto-review findings,\s*(\d+) human reviewer comments,\s*(\d+) total\s*\((\d+) critical,\s*(\d+) important,\s*(\d+) suggestion\/nit\)/,
  );
  if (!m) { return null; }
  return {
    autoReviewFindings: parseInt(m[1], 10),
    humanReviewerComments: parseInt(m[2], 10),
    totalItems: parseInt(m[3], 10),
    totalCritical: parseInt(m[4], 10),
    totalImportant: parseInt(m[5], 10),
    totalSuggestionOrNit: parseInt(m[6], 10),
  };
}

// ---------------------------------------------------------------------------
// Item heading parsing
// ---------------------------------------------------------------------------

interface ItemHeadingInfo {
  status: StatusMarker;
  source: Source;
  severity: Severity;
  file: string | null;
  line: number | null;
}

function parseItemHeading(line: string, offset: number, lineNumber: number, state: ParserState): ItemHeadingInfo {
  const m = ITEM_HEADING_RE.exec(line);
  if (!m) {
    throw new ParseError(`Invalid item heading: ${line}`, offset, state, lineNumber);
  }

  const rawMarker = m[1];
  const statusMap: Record<string, StatusMarker> = {
    '?': '[?]',
    'x': '[x]',
    '~': '[~]',
    'd': '[d]',
    '-': '[-]',
  };
  const status = statusMap[rawMarker];
  if (!status) {
    throw new ParseError(`Unknown status marker: [${rawMarker}]`, offset, state, lineNumber);
  }

  // Source tag
  let source: Source;
  let severity: Severity;

  if (m[2].startsWith('auto:')) {
    const sev = m[3] as Severity;
    source = { kind: 'auto-review' };
    severity = sev;
  } else {
    // reviewer:@LOGIN — severity comes from **Severity:** field, parse later
    const login = m[4]; // e.g. "@alice"
    source = { kind: 'reviewer', login };
    severity = 'nit'; // placeholder; will be overwritten from field
  }

  // Location
  const isReviewBody = m[5] === 'review body';
  const filePath = isReviewBody ? null : m[6] ?? null;
  const lineNum2 = isReviewBody ? null : (m[7] !== undefined ? parseInt(m[7], 10) : null);

  return { status, source, severity, file: filePath, line: lineNum2 };
}

// ---------------------------------------------------------------------------
// Partial item accumulator
// ---------------------------------------------------------------------------

interface ItemAccumulator {
  headingLine: string;
  headingOffset: number;
  headingLineNumber: number;
  status: StatusMarker;
  source: Source;
  severity: Severity;
  file: string | null;
  line: number | null;
  reportedBy: string[];
  comment: string;
  analysis: string;
  recommendation: string;
  options: string[];
  resolution: string;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export function parseDocument(raw: string): HandoverDocument {
  const lines = raw.split('\n');

  // Header fields (mutable during parse)
  let prUrl = '';
  let branchHeadRef = '';
  let branchHeadSha: string | undefined;
  let branchBaseRef = '';
  let branchBaseSha: string | undefined;
  let generatedAt = '';
  let status = '';
  let sourceCounts: DocumentHeader['sourceCounts'] | null = null;

  const items: FindingItem[] = [];

  let state: ParserState = 'IN_HEADER';
  let offset = 0;
  let currentItem: ItemAccumulator | null = null;
  let itemStartOffset = 0;

  // Track byte offset per line
  let lineOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    lineOffset = offset;
    const lineNum = i + 1;

    // -----------------------------------------------------------------------
    // IN_HEADER
    // -----------------------------------------------------------------------
    if (state === 'IN_HEADER') {
      const fieldMatch = FIELD_RE.exec(line);
      if (fieldMatch) {
        const key = fieldMatch[1].trim();
        const value = fieldMatch[2].trim();

        switch (key) {
          case 'PR':
            prUrl = value;
            break;

          case 'Branch': {
            // "feat/user-auth → main"
            const arrowIdx = value.indexOf(' → ');
            if (arrowIdx === -1) {
              throw new ParseError(
                `Malformed Branch line (missing →): ${value}`,
                lineOffset,
                'IN_HEADER',
                lineNum,
              );
            }
            branchHeadRef = value.slice(0, arrowIdx).trim();
            branchBaseRef = value.slice(arrowIdx + 3).trim();
            break;
          }

          case 'Head SHA':
            branchHeadSha = value;
            break;

          case 'Base SHA':
            branchBaseSha = value;
            break;

          case 'Generated':
            generatedAt = value;
            break;

          case 'Status':
            status = value;
            break;

          case 'Source counts': {
            const counts = parseSourceCounts(value);
            if (!counts) {
              throw new ParseError(`Malformed Source counts: ${value}`, lineOffset, 'IN_HEADER', lineNum);
            }
            sourceCounts = counts;
            break;
          }
        }
      } else if (line.trim() === '---') {
        // First separator — transition to between-items
        state = 'BETWEEN_ITEMS';
      }
      // Skip blank lines and h1 title
    }

    // -----------------------------------------------------------------------
    // BETWEEN_ITEMS — looking for next item heading
    // -----------------------------------------------------------------------
    else if (state === 'BETWEEN_ITEMS') {
      if (line.startsWith('## [')) {
        // Start of new item
        currentItem = parseItemHeadingToAccumulator(line, lineOffset, lineNum, 'BETWEEN_ITEMS');
        itemStartOffset = lineOffset;
        state = 'IN_ITEM_FIELDS';
      }
      // blank lines and --- are ignored
    }

    // -----------------------------------------------------------------------
    // IN_ITEM_FIELDS
    // -----------------------------------------------------------------------
    else if (state === 'IN_ITEM_FIELDS') {
      if (line.trim() === '---' || (line.startsWith('## [') && i === lines.length - 1)) {
        // Separator — finalize current item
        finalizeItem(currentItem!, raw, itemStartOffset, lineOffset, items);
        currentItem = null;
        state = 'BETWEEN_ITEMS';
      } else if (line.startsWith('## [')) {
        // Next heading without explicit separator
        finalizeItem(currentItem!, raw, itemStartOffset, lineOffset, items);
        currentItem = parseItemHeadingToAccumulator(line, lineOffset, lineNum, 'IN_ITEM_FIELDS');
        itemStartOffset = lineOffset;
        state = 'IN_ITEM_FIELDS';
      } else {
        // Parse named fields (includes Options, Resolution, and others)
        const fieldMatch = FIELD_RE.exec(line);
        if (fieldMatch && currentItem) {
          const key = fieldMatch[1].trim();
          const value = fieldMatch[2].trim();
          if (key === 'Options') {
            state = 'IN_OPTIONS';
          } else if (key === 'Resolution') {
            currentItem.resolution = value;
            state = 'IN_RESOLUTION';
          } else {
            applyField(currentItem, key, value);
          }
        }
        // Note lines, blank lines etc. are silently skipped (ride in rawSource)
      }
    }

    // -----------------------------------------------------------------------
    // IN_OPTIONS
    // -----------------------------------------------------------------------
    else if (state === 'IN_OPTIONS') {
      if (line.trim() === '---' || line.startsWith('## [')) {
        if (line.trim() === '---') {
          finalizeItem(currentItem!, raw, itemStartOffset, lineOffset, items);
          currentItem = null;
          state = 'BETWEEN_ITEMS';
        } else {
          finalizeItem(currentItem!, raw, itemStartOffset, lineOffset, items);
          currentItem = parseItemHeadingToAccumulator(line, lineOffset, lineNum, 'IN_OPTIONS');
          itemStartOffset = lineOffset;
          state = 'IN_ITEM_FIELDS';
        }
      } else {
        const fieldMatch = FIELD_RE.exec(line);
        if (fieldMatch && currentItem) {
          const key = fieldMatch[1].trim();
          const value = fieldMatch[2].trim();
          if (key === 'Resolution') {
            currentItem.resolution = value;
            state = 'IN_RESOLUTION';
          }
        } else if (line.startsWith('- ') && currentItem) {
          currentItem.options.push(line.slice(2).trim());
        }
      }
      // blank lines in options block are skipped
    }

    // -----------------------------------------------------------------------
    // IN_RESOLUTION
    // -----------------------------------------------------------------------
    else if (state === 'IN_RESOLUTION') {
      if (line.trim() === '---') {
        finalizeItem(currentItem!, raw, itemStartOffset, lineOffset, items);
        currentItem = null;
        state = 'BETWEEN_ITEMS';
      } else if (line.startsWith('## [')) {
        finalizeItem(currentItem!, raw, itemStartOffset, lineOffset, items);
        currentItem = parseItemHeadingToAccumulator(line, lineOffset, lineNum, 'IN_RESOLUTION');
        itemStartOffset = lineOffset;
        state = 'IN_ITEM_FIELDS';
      }
      // Additional resolution text lines are ignored for now
    }

    offset += line.length + 1; // +1 for the \n
  }

  // Finalize the last item if still open
  if (currentItem !== null) {
    finalizeItem(currentItem, raw, itemStartOffset, offset, items);
  }

  // Validate and return
  const document = HandoverDocumentSchema.parse({
    header: {
      prUrl,
      branch: {
        head: { ref: branchHeadRef, sha: branchHeadSha },
        base: { ref: branchBaseRef, sha: branchBaseSha },
      },
      generatedAt,
      status,
      sourceCounts: sourceCounts ?? {
        autoReviewFindings: 0,
        humanReviewerComments: 0,
        totalItems: 0,
        totalCritical: 0,
        totalImportant: 0,
        totalSuggestionOrNit: 0,
      },
    },
    items,
  });

  return document;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseItemHeadingToAccumulator(
  line: string,
  offset: number,
  lineNumber: number,
  state: ParserState,
): ItemAccumulator {
  const info = parseItemHeading(line, offset, lineNumber, state);
  return {
    headingLine: line,
    headingOffset: offset,
    headingLineNumber: lineNumber,
    status: info.status,
    source: info.source,
    severity: info.severity,
    file: info.file,
    line: info.line,
    reportedBy: [],
    comment: '',
    analysis: '',
    recommendation: '',
    options: [],
    resolution: '',
  };
}

function applyField(acc: ItemAccumulator, key: string, value: string): void {
  switch (key) {
    case 'Severity':
      acc.severity = value as Severity;
      break;
    case 'Source':
      // Source tag in heading is authoritative; skip
      break;
    case 'Reported by':
      acc.reportedBy = value.split(',').map((s) => s.trim()).filter(Boolean);
      break;
    case 'Comment':
      acc.comment = value;
      break;
    case 'Analysis':
      acc.analysis = value;
      break;
    case 'Recommendation':
      acc.recommendation = value;
      break;
    case 'Resolution':
      acc.resolution = value;
      break;
    // 'Note' and others are intentionally ignored
  }
}

function finalizeItem(
  acc: ItemAccumulator,
  raw: string,
  startOffset: number,
  endOffset: number,
  out: FindingItem[],
): void {
  // rawSource: the slice from start of heading to just before the separator
  // Trim trailing whitespace/newlines that are part of the separator gap
  let rawEnd = endOffset;
  // Walk back to trim trailing blank lines before ---
  while (rawEnd > startOffset && (raw[rawEnd - 1] === '\n' || raw[rawEnd - 1] === '\r' || raw[rawEnd - 1] === ' ')) {
    rawEnd--;
  }
  const rawSource = raw.slice(startOffset, rawEnd);

  out.push({
    status: acc.status,
    source: acc.source,
    file: acc.file,
    line: acc.line,
    severity: acc.severity,
    reportedBy: acc.reportedBy,
    comment: acc.comment,
    analysis: acc.analysis,
    recommendation: acc.recommendation,
    options: acc.options,
    resolution: acc.resolution,
    rawSource,
    dirty: false,
  });
}
