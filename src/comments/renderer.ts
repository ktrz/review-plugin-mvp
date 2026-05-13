import type * as vscode from 'vscode';
import type { HandoverDocument } from '../schema';
import {
  buildThreadEntry as defaultBuildThreadEntry,
  type ThreadEntry,
} from './thread-builder';

export interface RenderFindingsDeps {
  doc: HandoverDocument;
  controller: vscode.CommentController;
  workspaceRoot: string;
  buildThreadEntry?: typeof defaultBuildThreadEntry;
}

export interface RenderFindingsResult {
  fileEntries: readonly ThreadEntry[];
  skippedPrLevel: number;
}

export function renderFindings(deps: RenderFindingsDeps): RenderFindingsResult {
  const { doc, controller, workspaceRoot, buildThreadEntry = defaultBuildThreadEntry } = deps;
  const fileEntries: ThreadEntry[] = [];
  let skippedPrLevel = 0;

  for (const finding of doc.items) {
    if (finding.location.kind === 'review-body') {
      skippedPrLevel += 1;
      continue;
    }
    const entry = buildThreadEntry({ finding, controller, workspaceRoot });
    if (entry !== null) {
      fileEntries.push(entry);
    }
  }

  return { fileEntries, skippedPrLevel };
}
