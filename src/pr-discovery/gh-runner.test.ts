import { describe, expect, it, vi } from 'vitest';
import { discoverPrNumber, type AskUser, type GhRunner } from './gh-runner';

const WORKSPACE = '/tmp/repo';

function makeRunGh(impl: GhRunner): GhRunner {
  return vi.fn(impl);
}

function makeAskUser(impl: AskUser): AskUser {
  return vi.fn(impl);
}

describe('discoverPrNumber', () => {
  it('returns the PR number from `gh pr view` JSON', async () => {
    const runGh = makeRunGh(async () => ({ stdout: JSON.stringify({ number: 42 }) }));
    const askUser = makeAskUser(async () => undefined);

    const result = await discoverPrNumber({ workspaceRoot: WORKSPACE, runGh, askUser });

    expect(result).toBe(42);
    expect(runGh).toHaveBeenCalledWith(
      ['pr', 'view', '--json', 'number'],
      { cwd: WORKSPACE },
    );
    expect(askUser).not.toHaveBeenCalled();
  });

  it('passes the workspaceRoot as cwd to the gh runner', async () => {
    const runGh = makeRunGh(async () => ({ stdout: JSON.stringify({ number: 7 }) }));
    const askUser = makeAskUser(async () => undefined);

    await discoverPrNumber({ workspaceRoot: '/some/other/path', runGh, askUser });

    expect(runGh).toHaveBeenCalledWith(expect.any(Array), { cwd: '/some/other/path' });
  });

  it('falls back to askUser when gh throws', async () => {
    const runGh = makeRunGh(async () => {
      throw new Error('gh: not authenticated');
    });
    const askUser = makeAskUser(async () => '99');

    const result = await discoverPrNumber({ workspaceRoot: WORKSPACE, runGh, askUser });

    expect(result).toBe(99);
    expect(askUser).toHaveBeenCalledTimes(1);
  });

  it('falls back to askUser when stdout is not valid JSON', async () => {
    const runGh = makeRunGh(async () => ({ stdout: 'not json at all' }));
    const askUser = makeAskUser(async () => '12');

    const result = await discoverPrNumber({ workspaceRoot: WORKSPACE, runGh, askUser });

    expect(result).toBe(12);
    expect(askUser).toHaveBeenCalledTimes(1);
  });

  it('falls back to askUser when JSON has no numeric `number` field', async () => {
    const runGh = makeRunGh(async () => ({ stdout: JSON.stringify({ number: 'abc' }) }));
    const askUser = makeAskUser(async () => '5');

    const result = await discoverPrNumber({ workspaceRoot: WORKSPACE, runGh, askUser });

    expect(result).toBe(5);
    expect(askUser).toHaveBeenCalledTimes(1);
  });

  it('falls back to askUser when JSON `number` is zero', async () => {
    const runGh = makeRunGh(async () => ({ stdout: JSON.stringify({ number: 0 }) }));
    const askUser = makeAskUser(async () => '8');

    const result = await discoverPrNumber({ workspaceRoot: WORKSPACE, runGh, askUser });

    expect(result).toBe(8);
    expect(askUser).toHaveBeenCalledTimes(1);
  });

  it('falls back to askUser when JSON `number` is negative', async () => {
    const runGh = makeRunGh(async () => ({ stdout: JSON.stringify({ number: -3 }) }));
    const askUser = makeAskUser(async () => '4');

    const result = await discoverPrNumber({ workspaceRoot: WORKSPACE, runGh, askUser });

    expect(result).toBe(4);
    expect(askUser).toHaveBeenCalledTimes(1);
  });

  it('falls back to askUser when JSON `number` is not an integer', async () => {
    const runGh = makeRunGh(async () => ({ stdout: JSON.stringify({ number: 1.5 }) }));
    const askUser = makeAskUser(async () => '6');

    const result = await discoverPrNumber({ workspaceRoot: WORKSPACE, runGh, askUser });

    expect(result).toBe(6);
    expect(askUser).toHaveBeenCalledTimes(1);
  });

  it('returns null when the user cancels the input box', async () => {
    const runGh = makeRunGh(async () => {
      throw new Error('gh failed');
    });
    const askUser = makeAskUser(async () => undefined);

    const result = await discoverPrNumber({ workspaceRoot: WORKSPACE, runGh, askUser });

    expect(result).toBeNull();
  });

  it('returns null when the user submits an empty string', async () => {
    const runGh = makeRunGh(async () => {
      throw new Error('gh failed');
    });
    const askUser = makeAskUser(async () => '');

    const result = await discoverPrNumber({ workspaceRoot: WORKSPACE, runGh, askUser });

    expect(result).toBeNull();
  });

  it('parses a numeric string entered by the user', async () => {
    const runGh = makeRunGh(async () => {
      throw new Error('boom');
    });
    const askUser = makeAskUser(async () => '  123  ');

    const result = await discoverPrNumber({ workspaceRoot: WORKSPACE, runGh, askUser });

    expect(result).toBe(123);
  });

  it('returns null when the user enters non-numeric text', async () => {
    const runGh = makeRunGh(async () => {
      throw new Error('boom');
    });
    const askUser = makeAskUser(async () => 'not-a-number');

    const result = await discoverPrNumber({ workspaceRoot: WORKSPACE, runGh, askUser });

    expect(result).toBeNull();
  });

  it('returns null when the user enters zero', async () => {
    const runGh = makeRunGh(async () => {
      throw new Error('boom');
    });
    const askUser = makeAskUser(async () => '0');

    const result = await discoverPrNumber({ workspaceRoot: WORKSPACE, runGh, askUser });

    expect(result).toBeNull();
  });

  it('returns null when the user enters a negative number', async () => {
    const runGh = makeRunGh(async () => {
      throw new Error('boom');
    });
    const askUser = makeAskUser(async () => '-5');

    const result = await discoverPrNumber({ workspaceRoot: WORKSPACE, runGh, askUser });

    expect(result).toBeNull();
  });
});
