import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';

const isWindows = process.platform === 'win32';

// Cap captured output (10MB per stream) so a noisy process cannot exhaust memory.
const MAX_BUFFER_SIZE = 10 * 1024 * 1024;
// Time between SIGTERM and SIGKILL when a run has to be stopped.
const KILL_GRACE_MS = 3000;

/** Escape an argument for the Windows shell (cmd.exe). */
function escapeArgForWindows(arg: string): string {
  let escaped = arg.replace(/%/g, '%%');
  if (/[\s"&|<>^%]/.test(arg)) {
    escaped = `"${escaped.replace(/"/g, '""')}"`;
  }
  return escaped;
}

export interface RunOptions {
  cwd?: string;
  /** Added on top of the inherited environment. */
  env?: Record<string, string>;
  /** Written to the child's stdin, which is then closed. */
  stdin?: string;
  /** Hard limit; the child's process group is killed when it passes. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  aborted: boolean;
}

// Children still running, so they can be stopped when the server exits.
const running = new Set<number>();

function killTree(pid: number, signal: NodeJS.Signals): void {
  try {
    // The child leads its own process group (detached), so this also reaches
    // helpers it started, such as its MCP servers.
    process.kill(isWindows ? pid : -pid, signal);
  } catch {
    // Already gone.
  }
}

process.on('exit', () => {
  for (const pid of running) killTree(pid, 'SIGKILL');
});

/**
 * Run a command to completion. Resolves with the exit code and captured
 * output whatever the outcome; rejects only when the process cannot start.
 */
export function runCommand(
  file: string,
  args: string[],
  options: RunOptions = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      file,
      isWindows ? args.map(escapeArgForWindows) : args,
      {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        shell: isWindows,
        detached: !isWindows,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let timer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;

    const stop = () => {
      if (child.pid === undefined || killTimer) return;
      const pid = child.pid;
      killTree(pid, 'SIGTERM');
      killTimer = setTimeout(() => killTree(pid, 'SIGKILL'), KILL_GRACE_MS);
    };
    const onAbort = () => {
      aborted = true;
      stop();
    };

    child.on('spawn', () => {
      if (child.pid !== undefined) running.add(child.pid);
      if (options.timeoutMs) {
        timer = setTimeout(() => {
          timedOut = true;
          stop();
        }, options.timeoutMs);
      }
      if (options.signal?.aborted) onAbort();
      else options.signal?.addEventListener('abort', onAbort, { once: true });
    });

    const append = (current: string, data: Buffer): string =>
      current.length >= MAX_BUFFER_SIZE
        ? current
        : current + data.toString().slice(0, MAX_BUFFER_SIZE - current.length);
    child.stdout.on('data', (data: Buffer) => {
      stdout = append(stdout, data);
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr = append(stderr, data);
    });

    // The child may exit before reading its input; that is not our error.
    child.stdin.on('error', () => {});
    child.stdin.end(options.stdin ?? '');

    const cleanup = () => {
      if (child.pid !== undefined) running.delete(child.pid);
      clearTimeout(timer);
      clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', onAbort);
    };

    child.on('error', (error) => {
      cleanup();
      reject(error);
    });
    child.on('close', (code) => {
      cleanup();
      resolve({ stdout, stderr, code, timedOut, aborted });
    });
  });
}
