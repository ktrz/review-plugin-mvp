import type * as vscode from 'vscode';
import type { HandoverDocument } from '../schema';
import { buildThread as defaultBuildThread } from './thread-builder';

export interface RenderFindingsDeps {
  doc: HandoverDocument;
  controller: vscode.CommentController;
  workspaceRoot: string;
  buildThread?: typeof defaultBuildThread;
}

export interface RenderFindingsResult {
  fileThreads: vscode.CommentThread[];
  skippedPrLevel: number;
}

export function renderFindings(deps: RenderFindingsDeps): RenderFindingsResult {
  const { doc, controller, workspaceRoot, buildThread = defaultBuildThread } = deps;
  const fileThreads: vscode.CommentThread[] = [];
  let skippedPrLevel = 0;

  for (const finding of doc.items) {
    if (finding.location.kind === 'review-body') {
      skippedPrLevel += 1;
      continue;
    }
    const thread = buildThread({ finding, controller, workspaceRoot });
    if (thread !== null) {
      fileThreads.push(thread);
    }
  }

  return { fileThreads, skippedPrLevel };
}
