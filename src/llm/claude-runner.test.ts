import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  ClaudeRunnerError,
  createClaudeRunner,
  type ClaudeSpawn,
} from './claude-runner';

type ScriptedExit = {
  stdout?: string;
  stderr?: string;
  code?: number | null;
  signal?: NodeJS.Signals | null;
  spawnError?: NodeJS.ErrnoException;
};

type FakeChild = EventEmitter & {
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: (signal?: NodeJS.Signals) => boolean;
};

function buildFakeChild(): FakeChild {
  const child: FakeChild = Object.assign(new EventEmitter(), {
    stdin: { write: vi.fn(), end: vi.fn() },
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(() => true),
  });
  return child;
}

function makeSpawn(script: ScriptedExit): {
  spawn: ClaudeSpawn;
  child: FakeChild;
  calls: Array<{ command: string; args: readonly string[]; options: { cwd: string } }>;
} {
  const calls: Array<{
    command: string;
    args: readonly string[];
    options: { cwd: string };
  }> = [];
  const child = buildFakeChild();

  const spawn: ClaudeSpawn = (command, args, options) => {
    calls.push({ command, args, options });
    queueMicrotask(() => {
      if (script.spawnError) {
        child.emit('error', script.spawnError);
        return;
      }
      if (script.stdout !== undefined) {
        child.stdout.emit('data', Buffer.from(script.stdout));
      }
      if (script.stderr !== undefined) {
        child.stderr.emit('data', Buffer.from(script.stderr));
      }
      child.emit('close', script.code ?? 0, script.signal ?? null);
    });
    return child;
  };

  return { spawn, child, calls };
}

const baseDeps = (overrides: Partial<{
  cliPath: string;
  extraArgs: string[];
  workspaceRoot: string;
}> = {}) => ({
  getCliPath: () => overrides.cliPath ?? 'claude',
  getExtraArgs: () => overrides.extraArgs ?? [],
  getWorkspaceRoot: () => overrides.workspaceRoot ?? '/tmp/repo',
});

describe('createClaudeRunner', () => {
  it('resolves with trimmed stdout on exit code 0', async () => {
    const { spawn } = makeSpawn({ stdout: 'hello world\n', code: 0 });
    const runner = createClaudeRunner({ spawn, ...baseDeps() });
    const ctrl = new AbortController();

    await expect(runner.run('prompt here', ctrl.signal)).resolves.toBe(
      'hello world',
    );
  });

  it('writes the prompt to stdin and closes it', async () => {
    const { spawn, child } = makeSpawn({ stdout: 'ok', code: 0 });
    const runner = createClaudeRunner({ spawn, ...baseDeps() });

    await runner.run('the prompt', new AbortController().signal);

    expect(child.stdin.write).toHaveBeenCalledWith('the prompt');
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
  });

  it('passes cliPath, -p flag, extraArgs, and cwd to spawn', async () => {
    const { spawn, calls } = makeSpawn({ stdout: 'ok', code: 0 });
    const runner = createClaudeRunner({
      spawn,
      ...baseDeps({
        cliPath: '/usr/local/bin/claude',
        extraArgs: ['--foo', 'bar'],
        workspaceRoot: '/workspace/repo',
      }),
    });

    await runner.run('p', new AbortController().signal);

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('/usr/local/bin/claude');
    expect(calls[0].args).toEqual(['-p', '--foo', 'bar']);
    expect(calls[0].options.cwd).toBe('/workspace/repo');
  });

  it('rejects with kind=enoent when spawn emits ENOENT', async () => {
    const err: NodeJS.ErrnoException = Object.assign(new Error('not found'), {
      code: 'ENOENT',
    });
    const { spawn } = makeSpawn({ spawnError: err });
    const runner = createClaudeRunner({ spawn, ...baseDeps() });

    await expect(runner.run('p', new AbortController().signal)).rejects.toBeInstanceOf(
      ClaudeRunnerError,
    );

    const { spawn: spawn2 } = makeSpawn({ spawnError: err });
    const runner2 = createClaudeRunner({ spawn: spawn2, ...baseDeps() });
    try {
      await runner2.run('p', new AbortController().signal);
      throw new Error('expected reject');
    } catch (e) {
      expect(e).toBeInstanceOf(ClaudeRunnerError);
      const ce = e as ClaudeRunnerError;
      expect(ce.kind).toBe('enoent');
      expect(ce.code).toBeNull();
    }
  });

  it('rejects with kind=exit and captured stderr on non-zero exit', async () => {
    const { spawn } = makeSpawn({
      stdout: 'partial',
      stderr: 'something broke',
      code: 2,
    });
    const runner = createClaudeRunner({ spawn, ...baseDeps() });

    try {
      await runner.run('p', new AbortController().signal);
      throw new Error('expected reject');
    } catch (e) {
      expect(e).toBeInstanceOf(ClaudeRunnerError);
      const ce = e as ClaudeRunnerError;
      expect(ce.kind).toBe('exit');
      expect(ce.code).toBe(2);
      expect(ce.stderr).toBe('something broke');
    }
  });

  it('rejects with kind=auth when stderr matches not-authenticated pattern', async () => {
    const { spawn } = makeSpawn({
      stderr: 'Error: you are not logged in. Run `claude login`.',
      code: 1,
    });
    const runner = createClaudeRunner({ spawn, ...baseDeps() });

    try {
      await runner.run('p', new AbortController().signal);
      throw new Error('expected reject');
    } catch (e) {
      expect(e).toBeInstanceOf(ClaudeRunnerError);
      const ce = e as ClaudeRunnerError;
      expect(ce.kind).toBe('auth');
      expect(ce.code).toBe(1);
      expect(ce.stderr).toMatch(/not logged in/i);
    }
  });

  it('rejects with kind=auth when stderr says "not authenticated"', async () => {
    const { spawn } = makeSpawn({
      stderr: 'You are not authenticated.',
      code: 1,
    });
    const runner = createClaudeRunner({ spawn, ...baseDeps() });

    try {
      await runner.run('p', new AbortController().signal);
      throw new Error('expected reject');
    } catch (e) {
      const ce = e as ClaudeRunnerError;
      expect(ce.kind).toBe('auth');
    }
  });

  it('rejects with kind=aborted when signal aborts mid-run and sends SIGTERM', async () => {
    const ctrl = new AbortController();
    const calls: Array<{
      command: string;
      args: readonly string[];
      options: { cwd: string };
    }> = [];
    const inner = new EventEmitter();
    const killFn = vi.fn(() => {
      queueMicrotask(() => inner.emit('close', null, 'SIGTERM'));
      return true;
    });
    const child: FakeChild = Object.assign(inner, {
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: killFn,
    });

    const spawn: ClaudeSpawn = (command, args, options) => {
      calls.push({ command, args, options });
      return child;
    };

    const runner = createClaudeRunner({ spawn, ...baseDeps() });
    const pending = runner.run('p', ctrl.signal);

    queueMicrotask(() => ctrl.abort());

    try {
      await pending;
      throw new Error('expected reject');
    } catch (e) {
      expect(e).toBeInstanceOf(ClaudeRunnerError);
      const ce = e as ClaudeRunnerError;
      expect(ce.kind).toBe('aborted');
      expect(killFn).toHaveBeenCalledTimes(1);
      expect(killFn).toHaveBeenCalledWith('SIGTERM');
    }
  });

  it('rejects with kind=aborted immediately if signal already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const { spawn } = makeSpawn({ stdout: 'never', code: 0 });
    const runner = createClaudeRunner({ spawn, ...baseDeps() });

    try {
      await runner.run('p', ctrl.signal);
      throw new Error('expected reject');
    } catch (e) {
      const ce = e as ClaudeRunnerError;
      expect(ce).toBeInstanceOf(ClaudeRunnerError);
      expect(ce.kind).toBe('aborted');
    }
  });
});
