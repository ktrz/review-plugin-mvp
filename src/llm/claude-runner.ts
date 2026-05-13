export type ClaudeRunnerErrorKind = 'enoent' | 'exit' | 'auth' | 'aborted';

export class ClaudeRunnerError extends Error {
  constructor(
    message: string,
    public readonly kind: ClaudeRunnerErrorKind,
    public readonly stderr: string,
    public readonly code: number | null,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ClaudeRunnerError';
  }
}

export interface ClaudeChildStream {
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
}

export interface ClaudeChildStdin {
  write(chunk: string): unknown;
  end(): unknown;
}

export interface ClaudeChildProcess {
  stdin: ClaudeChildStdin | null;
  stdout: ClaudeChildStream | null;
  stderr: ClaudeChildStream | null;
  on(event: 'error', listener: (err: NodeJS.ErrnoException) => void): unknown;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export type ClaudeSpawn = (
  command: string,
  args: readonly string[],
  options: { cwd: string; stdio: ['pipe', 'pipe', 'pipe'] },
) => ClaudeChildProcess;

export interface ClaudeRunnerDeps {
  spawn: ClaudeSpawn;
  getCliPath: () => string;
  getExtraArgs: () => readonly string[];
  getWorkspaceRoot: () => string;
}

export interface ClaudeRunner {
  run(prompt: string, signal: AbortSignal): Promise<string>;
}

export function createClaudeRunner(deps: ClaudeRunnerDeps): ClaudeRunner {
  return {
    run(prompt, signal) {
      return runOnce(deps, prompt, signal);
    },
  };
}

function runOnce(
  deps: ClaudeRunnerDeps,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) {
    return Promise.reject(
      new ClaudeRunnerError('chat aborted before spawn', 'aborted', '', null),
    );
  }

  const cliPath = deps.getCliPath();
  const args = ['-p', ...deps.getExtraArgs()];
  const cwd = deps.getWorkspaceRoot();

  return new Promise<string>((resolve, reject) => {
    let child: ClaudeChildProcess;
    try {
      child = deps.spawn(cliPath, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(
        new ClaudeRunnerError(
          'failed to spawn claude CLI',
          classifySpawnError(err),
          '',
          null,
          { cause: err },
        ),
      );
      return;
    }

    let stdoutBuf = '';
    let stderrBuf = '';
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener('abort', onAbort);
      fn();
    };

    const onAbort = () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // kill is best-effort; the close handler still resolves the promise
      }
      settle(() =>
        reject(
          new ClaudeRunnerError('chat aborted', 'aborted', stderrBuf, null),
        ),
      );
    };

    signal.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdoutBuf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderrBuf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      settle(() =>
        reject(
          new ClaudeRunnerError(
            err.message || 'spawn failed',
            classifySpawnError(err),
            stderrBuf,
            null,
            { cause: err },
          ),
        ),
      );
    });

    child.on('close', (code: number | null) => {
      settle(() => {
        if (code === 0) {
          const output = stdoutBuf.replace(/\n+$/, '').trim();
          if (output.length === 0) {
            reject(
              new ClaudeRunnerError(
                'claude CLI returned empty output',
                'exit',
                stderrBuf,
                code,
              ),
            );
            return;
          }
          resolve(output);
          return;
        }
        const kind: ClaudeRunnerErrorKind = isAuthFailure(stderrBuf)
          ? 'auth'
          : 'exit';
        reject(
          new ClaudeRunnerError(
            `claude CLI exited with code ${code ?? 'null'}`,
            kind,
            stderrBuf,
            code,
          ),
        );
      });
    });

    try {
      child.stdin?.write(prompt);
      child.stdin?.end();
    } catch (err) {
      settle(() =>
        reject(
          new ClaudeRunnerError(
            'failed to write prompt to stdin',
            'exit',
            stderrBuf,
            null,
            { cause: err },
          ),
        ),
      );
    }
  });
}

function classifySpawnError(err: unknown): ClaudeRunnerErrorKind {
  if (
    typeof err === 'object' &&
    err !== null &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  ) {
    return 'enoent';
  }
  return 'exit';
}

function isAuthFailure(stderr: string): boolean {
  return /not (logged in|authenticated)/i.test(stderr);
}
