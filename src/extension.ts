import * as vscode from 'vscode';
import { setOutputChannel, clearState } from './runtime/findings-state';
import {
  disposeActiveWatcher,
  registerLoadFindingsCommand,
} from './commands/load-findings';

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('Review Plugin');
  setOutputChannel(channel);
  context.subscriptions.push(channel);
  registerLoadFindingsCommand(context);
}

export function deactivate(): void {
  clearState();
  disposeActiveWatcher();
}
