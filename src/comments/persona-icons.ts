import * as vscode from 'vscode';

export interface PersonaIcons {
  autoReview: vscode.Uri;
  reviewer: vscode.Uri;
  user: vscode.Uri;
  agent: vscode.Uri;
}

let icons: PersonaIcons | undefined;

export function setPersonaIcons(next: PersonaIcons): void {
  icons = next;
}

export function getPersonaIcons(): PersonaIcons | undefined {
  return icons;
}

export function clearPersonaIcons(): void {
  icons = undefined;
}

export function createPersonaIcons(extensionUri: vscode.Uri): PersonaIcons {
  return {
    autoReview: vscode.Uri.joinPath(extensionUri, 'media', 'avatar-auto-review.svg'),
    reviewer: vscode.Uri.joinPath(extensionUri, 'media', 'avatar-reviewer.svg'),
    user: vscode.Uri.joinPath(extensionUri, 'media', 'avatar-user.svg'),
    agent: vscode.Uri.joinPath(extensionUri, 'media', 'avatar-agent.svg'),
  };
}
