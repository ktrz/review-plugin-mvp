import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

describe('vscode shim alias', () => {
  it('resolves the vscode module to the test shim', () => {
    expect(vscode.CommentMode.Preview).toBe(1);
    expect(vscode.CommentMode.Editing).toBe(0);
    expect(vscode.CommentThreadCollapsibleState.Collapsed).toBe(0);
    expect(vscode.CommentThreadCollapsibleState.Expanded).toBe(1);
  });

  it('Uri.file returns a stable object with fsPath', () => {
    const u = vscode.Uri.file('/tmp/a.md');
    expect(u.fsPath).toBe('/tmp/a.md');
    expect(u.scheme).toBe('file');
    expect(u.toString()).toBe('/tmp/a.md');
  });

  it('RelativePattern stores base and pattern', () => {
    const rp = new vscode.RelativePattern(vscode.Uri.file('/a/b'), '*.md');
    expect(rp.pattern).toBe('*.md');
    expect(rp.base).toBeDefined();
  });

  it('Range / Position store coordinates', () => {
    const r = new vscode.Range(1, 2, 3, 4);
    expect(r.start.line).toBe(1);
    expect(r.start.character).toBe(2);
    expect(r.end.line).toBe(3);
    expect(r.end.character).toBe(4);

    const p = new vscode.Position(5, 6);
    expect(p.line).toBe(5);
    expect(p.character).toBe(6);
  });

  it('MarkdownString supports appendMarkdown', () => {
    const md = new vscode.MarkdownString('hello');
    expect(md.value).toBe('hello');
    md.appendMarkdown(' world');
    expect(md.value).toBe('hello world');
  });

  it('EventEmitter fires registered listeners and supports dispose', () => {
    const ee = new vscode.EventEmitter<number>();
    const seen: number[] = [];
    const sub = ee.event((n) => seen.push(n));
    ee.fire(1);
    ee.fire(2);
    sub.dispose();
    ee.fire(3);
    expect(seen).toEqual([1, 2]);
    ee.dispose();
  });

  it('exposes mockable workspace / window / commands / comments namespaces', () => {
    expect(typeof vscode.workspace).toBe('object');
    expect(typeof vscode.window).toBe('object');
    expect(typeof vscode.commands).toBe('object');
    expect(typeof vscode.comments).toBe('object');
  });
});
