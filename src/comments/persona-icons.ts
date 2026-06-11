import * as vscode from 'vscode';

export type PersonaIcons = {
  readonly autoReview: vscode.Uri;
  readonly user: vscode.Uri;
  readonly agent: vscode.Uri;
};

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

export function personaIconPath(persona: keyof PersonaIcons): vscode.Uri | undefined {
  return icons?.[persona];
}

export function createPersonaIcons(extensionUri: vscode.Uri): PersonaIcons {
  return {
    autoReview: vscode.Uri.joinPath(extensionUri, 'media', 'avatar-auto-review.svg'),
    user: vscode.Uri.joinPath(extensionUri, 'media', 'avatar-user.svg'),
    agent: vscode.Uri.joinPath(extensionUri, 'media', 'avatar-agent.svg'),
  };
}
