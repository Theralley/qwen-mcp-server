import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import {
  buildChildEnv,
  durationToMs,
  loadConfig,
  readApiKey,
} from '../config.js';
import { ConfigError, ToolExecutionError, ValidationError } from '../errors.js';
import { InMemorySessionStorage } from '../session/storage.js';
import {
  HelpToolSchema,
  ListSessionsToolSchema,
  PingToolSchema,
  QwenToolSchema,
  TOOLS,
  type QwenToolArgs,
  type ToolHandlerContext,
  type ToolName,
  type ToolResult,
} from '../types.js';
import { runCommand, type RunResult } from '../utils/command.js';
import { buildQwenArgs, parseQwenOutput, scrub, tail } from '../utils/qwen.js';

/**
 * Every credential value the child can see: the key from the key file and any key the
 * server inherited in the variables Qwen Code reads. Removed from all returned text.
 */
function secretValues(
  config: ReturnType<typeof loadConfig>,
  apiKey: string | undefined
): string[] {
  const names = ['OPENAI_API_KEY', 'DASHSCOPE_API_KEY', ...config.apiKeyEnv];
  const inherited = names.map((name) => process.env[name]?.trim());
  return [apiKey, ...inherited].filter(
    (v): v is string => typeof v === 'string' && v.length > 0
  );
}

/** Scrub every string in a JSON-shaped value (the result metadata). */
function scrubDeep<T>(value: T, secrets: string[]): T {
  if (secrets.length === 0) return value;
  return JSON.parse(scrub(JSON.stringify(value), secrets)) as T;
}

/**
 * Tools a plan-mode call may pre-approve. Qwen Code 0.28 runs an explicitly allowed
 * tool such as write_file before its plan-mode check, so only shell commands, which
 * plan mode always checks for being read-only, can be listed.
 */
function checkPlanAllowedTools(tools: string[] | undefined): void {
  const refused = (tools ?? []).filter(
    (tool) => !/^run_shell_command\(.+\)$/.test(tool.trim())
  );
  if (refused.length > 0) {
    throw new ValidationError(
      TOOLS.QWEN,
      `in approval mode "plan", allowedTools may only list shell commands (run_shell_command(...)); refused: ${refused.join(', ')}. Pass approvalMode "default" or "auto-edit" for other tools.`
    );
  }
}

const defaultContext: ToolHandlerContext = {
  sendProgress: async () => {},
};

// Qwen Code's exit code when --max-wall-time or another run budget is exceeded.
const EXIT_BUDGET_EXCEEDED = 55;
// How long past the wall-time budget the process is killed outright.
const HARD_KILL_MARGIN_MS = 30_000;
const PROGRESS_INTERVAL_MS = 15_000;

/** Turn Zod and other unexpected errors into the tool's error types. */
function wrapError(tool: ToolName, error: unknown): Error {
  if (
    error instanceof ValidationError ||
    error instanceof ToolExecutionError ||
    error instanceof ConfigError
  ) {
    return error;
  }
  if (error instanceof ZodError) {
    return new ValidationError(
      tool,
      error.issues.map((issue) => issue.message).join('; ')
    );
  }
  return new ToolExecutionError(
    tool,
    error instanceof Error ? error.message : String(error)
  );
}

export class QwenToolHandler {
  // One run at a time per caller session, so turns cannot interleave.
  private queues = new Map<string, Promise<unknown>>();

  constructor(private sessionStorage: InMemorySessionStorage) {}

  async execute(
    args: unknown,
    context: ToolHandlerContext = defaultContext
  ): Promise<ToolResult> {
    try {
      const parsed = QwenToolSchema.parse(args);
      const { sessionId } = parsed;
      if (!sessionId) return await this.run(parsed, context);

      const previous = this.queues.get(sessionId) ?? Promise.resolve();
      const current = previous
        .catch(() => {})
        .then(() => this.run(parsed, context));
      this.queues.set(sessionId, current);
      try {
        return await current;
      } finally {
        if (this.queues.get(sessionId) === current) {
          this.queues.delete(sessionId);
        }
      }
    } catch (error) {
      throw wrapError(TOOLS.QWEN, error);
    }
  }

  private async run(
    args: QwenToolArgs,
    context: ToolHandlerContext
  ): Promise<ToolResult> {
    const { prompt, sessionId, workingDirectory } = args;
    const config = loadConfig();

    // A reset only replaces the mapping once the new run succeeds (recordTurn), so a
    // failed reset keeps the old conversation reachable.
    const session =
      sessionId && !args.resetSession
        ? this.sessionStorage.get(sessionId)
        : undefined;

    const requestedCwd = workingDirectory
      ? path.resolve(workingDirectory)
      : undefined;
    if (session && requestedCwd && requestedCwd !== session.cwd) {
      throw new ValidationError(
        TOOLS.QWEN,
        `session "${sessionId}" belongs to ${session.cwd}; a Qwen session can only be resumed from the directory it was started in. Omit workingDirectory, or pass resetSession: true to start over in ${requestedCwd}.`
      );
    }
    const cwd = session?.cwd ?? requestedCwd ?? process.cwd();
    if (!existsSync(cwd)) {
      throw new ValidationError(
        TOOLS.QWEN,
        `working directory does not exist: ${cwd}`
      );
    }

    const approvalMode = args.approvalMode ?? config.approvalMode;
    if (approvalMode === 'plan') checkPlanAllowedTools(args.allowedTools);

    const resume = session !== undefined;
    const qwenSessionId = session?.qwenSessionId ?? randomUUID();
    const model = args.model ?? config.defaultModel;
    const maxWallTime = args.maxWallTime ?? config.maxWallTime;
    const cmdArgs = buildQwenArgs({
      qwenSessionId,
      resume,
      approvalMode,
      maxWallTime,
      model,
      authType: config.authType,
      appendSystemPrompt: args.appendSystemPrompt,
      allowedTools: args.allowedTools,
    });

    const apiKey = readApiKey(config);
    const secrets = secretValues(config, apiKey);
    const clean = (text: string) => scrub(text, secrets);

    await context.sendProgress('Starting Qwen Code...');
    const startedAt = Date.now();
    const heartbeat = context.progressToken
      ? setInterval(() => {
          const seconds = Math.round((Date.now() - startedAt) / 1000);
          void context.sendProgress(`Qwen Code running (${seconds}s)...`);
        }, PROGRESS_INTERVAL_MS)
      : undefined;

    let result: RunResult;
    try {
      result = await runCommand(config.bin, cmdArgs, {
        cwd,
        env: buildChildEnv(config, apiKey),
        stdin: prompt,
        timeoutMs: durationToMs(maxWallTime) + HARD_KILL_MARGIN_MS,
        signal: context.signal,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ToolExecutionError(
        TOOLS.QWEN,
        `could not start "${config.bin}": ${clean(reason)}`
      );
    } finally {
      clearInterval(heartbeat);
    }

    const output = parseQwenOutput(result.stdout);

    if (
      result.code !== 0 ||
      result.aborted ||
      result.timedOut ||
      result.overflow ||
      output.isError
    ) {
      throw new ToolExecutionError(
        TOOLS.QWEN,
        clean(
          this.describeFailure(
            result,
            output.errorMessage,
            maxWallTime,
            resume
              ? `Could not resume Qwen session ${qwenSessionId} (sessionId "${sessionId}", directory ${cwd}). No fresh session was started; pass resetSession: true to begin a new one.`
              : undefined
          )
        )
      );
    }

    if (sessionId) {
      this.sessionStorage.recordTurn(sessionId, qwenSessionId, cwd);
    }

    const metadata: Record<string, unknown> = scrubDeep(
      {
        qwenSessionId: output.sessionId ?? qwenSessionId,
        ...(sessionId && { sessionId }),
        resumed: resume,
        workingDirectory: cwd,
        ...((output.model ?? model) && { model: output.model ?? model }),
        ...(output.permissionMode && { approvalMode: output.permissionMode }),
        ...(output.durationMs !== undefined && {
          durationMs: output.durationMs,
        }),
        ...(output.numTurns !== undefined && { numTurns: output.numTurns }),
        ...(output.usage && { usage: output.usage }),
        ...(!output.parsed && { rawOutput: true }),
      },
      secrets
    );

    return {
      content: [
        {
          type: 'text',
          text: clean(output.text) || 'No output from Qwen Code',
          _meta: metadata,
        },
      ],
      _meta: metadata,
    };
  }

  private describeFailure(
    result: RunResult,
    errorMessage: string | undefined,
    maxWallTime: string,
    resumeNote: string | undefined
  ): string {
    let summary: string;
    if (result.aborted) {
      summary = 'Qwen Code was stopped because the request was cancelled';
    } else if (result.overflow) {
      summary =
        'Qwen Code produced more output than the server keeps (10 MB per stream); the answer was cut off';
    } else if (result.timedOut) {
      summary = `Qwen Code did not stop at its wall-time budget (${maxWallTime}) and was killed`;
    } else if (result.code === EXIT_BUDGET_EXCEEDED) {
      summary = `Qwen Code exceeded its run budget (exit code ${EXIT_BUDGET_EXCEEDED}; max wall time ${maxWallTime})`;
    } else if (result.code === 0) {
      summary = 'Qwen Code reported an error';
    } else {
      summary = `Qwen Code exited with code ${result.code}`;
    }

    const parts = [
      resumeNote,
      errorMessage ? `${summary}: ${errorMessage}` : summary,
    ];
    const stderrTail = tail(result.stderr);
    if (stderrTail) parts.push(`stderr (tail):\n${stderrTail}`);
    return parts.filter(Boolean).join('\n');
  }
}

export class ListSessionsToolHandler {
  constructor(private sessionStorage: InMemorySessionStorage) {}

  async execute(
    args: unknown,
    _context: ToolHandlerContext = defaultContext
  ): Promise<ToolResult> {
    try {
      ListSessionsToolSchema.parse(args);
      const sessions = this.sessionStorage.list().map((session) => ({
        sessionId: session.id,
        qwenSessionId: session.qwenSessionId,
        workingDirectory: session.cwd,
        createdAt: session.createdAt.toISOString(),
        lastAccessedAt: session.lastAccessedAt.toISOString(),
        turnCount: session.turns,
      }));
      return {
        content: [
          {
            type: 'text',
            text:
              sessions.length > 0
                ? JSON.stringify(sessions, null, 2)
                : 'No active sessions',
          },
        ],
      };
    } catch (error) {
      throw wrapError(TOOLS.LIST_SESSIONS, error);
    }
  }
}

export class PingToolHandler {
  async execute(
    args: unknown,
    _context: ToolHandlerContext = defaultContext
  ): Promise<ToolResult> {
    try {
      const { message = 'pong' } = PingToolSchema.parse(args);
      return { content: [{ type: 'text', text: message }] };
    } catch (error) {
      throw wrapError(TOOLS.PING, error);
    }
  }
}

export class HelpToolHandler {
  async execute(
    args: unknown,
    _context: ToolHandlerContext = defaultContext
  ): Promise<ToolResult> {
    try {
      const { command } = HelpToolSchema.parse(args);
      const config = loadConfig();
      const { bin } = config;
      const secrets = secretValues(config, undefined);
      const flag = command === 'version' ? '--version' : '--help';
      const result = await runCommand(bin, [flag], { timeoutMs: 30_000 });
      if (result.code !== 0) {
        throw new ToolExecutionError(
          TOOLS.HELP,
          scrub(
            `"${bin} ${flag}" exited with code ${result.code}\n${tail(result.stderr)}`,
            secrets
          )
        );
      }
      return {
        content: [
          {
            type: 'text',
            text:
              scrub(result.stdout.trim(), secrets) ||
              'No output from Qwen Code',
          },
        ],
      };
    } catch (error) {
      throw wrapError(TOOLS.HELP, error);
    }
  }
}

const sessionStorage = new InMemorySessionStorage();

export const toolHandlers = {
  [TOOLS.QWEN]: new QwenToolHandler(sessionStorage),
  [TOOLS.LIST_SESSIONS]: new ListSessionsToolHandler(sessionStorage),
  [TOOLS.PING]: new PingToolHandler(),
  [TOOLS.HELP]: new HelpToolHandler(),
} as const;
