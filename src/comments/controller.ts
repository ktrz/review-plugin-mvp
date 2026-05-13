import * as vscode from 'vscode';

export type CreateCommentController = typeof vscode.comments.createCommentController;

export interface CreateFindingsControllerDeps {
  create?: CreateCommentController;
}

export const FINDINGS_CONTROLLER_ID = 'reviewPlugin.findings';
export const FINDINGS_CONTROLLER_LABEL = 'Review Plugin';

export function createFindingsController(
  deps: CreateFindingsControllerDeps = {},
): vscode.CommentController {
  const { create = vscode.comments.createCommentController } = deps;
  return create(FINDINGS_CONTROLLER_ID, FINDINGS_CONTROLLER_LABEL);
}
