import type * as vscode from 'vscode';
import type { HandoverDocument } from '../schema';

export type LoadedFindings = {
  doc: Readonly<HandoverDocument>;
  mtime: number;
  filePath: string;
  prNumber: number;
};

let current: LoadedFindings | null = null;
let channel: vscode.OutputChannel | null = null;

export function getState(): LoadedFindings | null {
  return current;
}

export function setState(next: LoadedFindings): void {
  current = next;
}

export function clearState(): void {
  current = null;
}

export function setOutputChannel(next: vscode.OutputChannel): void {
  channel = next;
}

export function getOutputChannel(): vscode.OutputChannel {
  if (channel === null) {
    throw new Error(
      'Review Plugin output channel has not been initialized — call setOutputChannel() during activate().',
    );
  }
  return channel;
}
