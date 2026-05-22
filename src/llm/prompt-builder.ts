import type { ChatMessage, FindingItem } from '../schema/types';
import type { HunkLoadResult } from './hunk-loader';

export interface BuildPromptInput {
  item: FindingItem;
  hunkResult: HunkLoadResult;
  transcript: readonly ChatMessage[];
  userMessage: string;
}

const PERSONA = [
  'You are reviewing a single code review finding with the user.',
  'Only this finding; do not bring up other findings.',
  'Use Read or Grep tools if the seed hunk below is insufficient.',
  'Discussion only: do NOT edit, write, or modify any files.',
  'Do NOT call Edit, Write, NotebookEdit, or any code-changing tool, and do NOT run shell commands that mutate the workspace.',
  'Do NOT apply, stage, or commit fixes — even if the user asks. If asked to fix, explain the change in prose and stop.',
  'Decisions are recorded later by the user via the plugin (decision log); your job is to analyze, weigh options, and recommend.',
].join('\n');

// TODO(backlog): include relationship metadata once the schema surfaces it
// per issue-6-discuss-chat plan (Bounded context discipline).

export function buildPrompt(input: BuildPromptInput): string {
  const sections: string[] = [];

  sections.push(PERSONA);
  sections.push(renderFinding(input.item));
  sections.push(renderHunk(input.hunkResult));
  sections.push(renderTranscript(input.transcript));
  sections.push(renderUser(input.userMessage));

  return sections.join('\n\n');
}

function renderFinding(item: FindingItem): string {
  const lines: string[] = ['## Finding'];
  lines.push(`- File: ${renderLocation(item)}`);
  lines.push(`- Severity: ${item.source.severity}`);
  lines.push(`- Source: ${renderSource(item)}`);
  lines.push('');
  lines.push('### Comment');
  lines.push(item.comment);
  lines.push('');
  lines.push('### Analysis');
  lines.push(item.analysis);
  lines.push('');
  lines.push('### Recommendation');
  lines.push(item.recommendation);
  if (item.options.length > 0) {
    lines.push('');
    lines.push('### Options');
    for (const opt of item.options) {
      lines.push(`- ${opt}`);
    }
  }
  return lines.join('\n');
}

function renderLocation(item: FindingItem): string {
  if (item.location.kind === 'file') {
    return `${item.location.file}:${item.location.line}`;
  }
  return '(review body)';
}

function renderSource(item: FindingItem): string {
  if (item.source.kind === 'reviewer') {
    return `@${item.source.login}`;
  }
  return 'auto-review';
}

function renderHunk(hunk: HunkLoadResult): string {
  return [
    `## Hunk (starting at line ${hunk.startLine})`,
    '```' + hunk.lang,
    hunk.hunk,
    '```',
  ].join('\n');
}

function renderTranscript(transcript: readonly ChatMessage[]): string {
  const lines: string[] = ['## Conversation so far'];
  if (transcript.length === 0) {
    lines.push('(none)');
    return lines.join('\n');
  }
  for (const msg of transcript) {
    lines.push(`${msg.role}: ${msg.content}`);
  }
  return lines.join('\n');
}

function renderUser(message: string): string {
  return `## User\n${message}`;
}
