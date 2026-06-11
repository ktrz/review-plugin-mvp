import { afterEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import {
  clearPersonaIcons,
  createPersonaIcons,
  getPersonaIcons,
  personaIconPath,
  setPersonaIcons,
  type PersonaIcons,
} from './persona-icons';

describe('persona-icons', () => {
  afterEach(() => clearPersonaIcons());

  it('getPersonaIcons returns undefined before setPersonaIcons is called', () => {
    clearPersonaIcons();
    expect(getPersonaIcons()).toBeUndefined();
  });

  it('set/get round-trip returns the same object', () => {
    const icons: PersonaIcons = {
      autoReview: vscode.Uri.file('/ext/avatar-auto-review.svg'),
      user: vscode.Uri.file('/ext/avatar-user.svg'),
      agent: vscode.Uri.file('/ext/avatar-agent.svg'),
    };
    setPersonaIcons(icons);
    expect(getPersonaIcons()).toBe(icons);
  });

  it('clearPersonaIcons resets to undefined', () => {
    const icons: PersonaIcons = {
      autoReview: vscode.Uri.file('/ext/avatar-auto-review.svg'),
      user: vscode.Uri.file('/ext/avatar-user.svg'),
      agent: vscode.Uri.file('/ext/avatar-agent.svg'),
    };
    setPersonaIcons(icons);
    clearPersonaIcons();
    expect(getPersonaIcons()).toBeUndefined();
  });

  it('createPersonaIcons builds URIs with the correct path segments', () => {
    const extUri = vscode.Uri.file('/ext');
    const icons = createPersonaIcons(extUri);
    expect(icons.autoReview.toString()).toContain('avatar-auto-review.svg');
    expect(icons.user.toString()).toContain('avatar-user.svg');
    expect(icons.agent.toString()).toContain('avatar-agent.svg');
  });

  describe('personaIconPath', () => {
    it('returns undefined when icons are not configured', () => {
      clearPersonaIcons();
      expect(personaIconPath('autoReview')).toBeUndefined();
    });

    it('returns the correct URI for each persona when icons are configured', () => {
      const icons: PersonaIcons = {
        autoReview: vscode.Uri.file('/ext/avatar-auto-review.svg'),
        user: vscode.Uri.file('/ext/avatar-user.svg'),
        agent: vscode.Uri.file('/ext/avatar-agent.svg'),
      };
      setPersonaIcons(icons);
      expect(personaIconPath('autoReview')).toBe(icons.autoReview);
      expect(personaIconPath('user')).toBe(icons.user);
      expect(personaIconPath('agent')).toBe(icons.agent);
    });
  });
});
