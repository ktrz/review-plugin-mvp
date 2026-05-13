import * as vscode from 'vscode';
import { setOutputChannel, clearState } from './runtime/findings-state';
import {
  disposeActiveWatcher,
  registerLoadFindingsCommand,
} from './commands/load-findings';
import { createFindingsController } from './comments/controller';
import { disposeAll as disposeActiveThreads } from './comments/render-session';

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('Review Plugin');
  setOutputChannel(channel);
  context.subscriptions.push(channel);
  const controller = createFindingsController();
  context.subscriptions.push(controller);
  registerLoadFindingsCommand(context, { controller });
}

export function deactivate(): void {
  disposeActiveThreads();
  clearState();
  disposeActiveWatcher();
}
