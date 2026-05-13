import { describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { createFindingsController } from './controller';

function makeFakeController(): vscode.CommentController {
  const fake = {
    id: 'reviewPlugin.findings',
    label: 'Review Plugin',
    createCommentThread: vi.fn(),
    dispose: vi.fn(),
  } satisfies Partial<vscode.CommentController>;
  return fake as vscode.CommentController;
}

describe('createFindingsController', () => {
  it('invokes the injected factory with the locked id and label', () => {
    const fake = makeFakeController();
    const create = vi.fn(() => fake);

    const result = createFindingsController({ create });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith('reviewPlugin.findings', 'Review Plugin');
    expect(result).toBe(fake);
  });

  it('returns the controller produced by the factory unchanged', () => {
    const fake = makeFakeController();
    const create = vi.fn(() => fake);

    const result = createFindingsController({ create });

    expect(result.id).toBe('reviewPlugin.findings');
    expect(result.label).toBe('Review Plugin');
  });

  it('falls back to the real vscode.comments.createCommentController when no factory is injected', async () => {
    const vscode = await import('vscode');
    const fake = makeFakeController();
    const spy = vi
      .mocked(vscode.comments.createCommentController)
      .mockReturnValueOnce(fake);

    const result = createFindingsController();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('reviewPlugin.findings', 'Review Plugin');
    expect(result).toBe(fake);
  });
});
