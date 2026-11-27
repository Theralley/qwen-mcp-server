import { type ApprovalModeName } from '../types.js';

export interface QwenArgsInput {
  /** UUID of the Qwen session to create or continue. */
  qwenSessionId: string;
  resume: boolean;
  approvalMode: ApprovalModeName;
  maxWallTime: string;
  model?: string;
  authType?: string;
  appendSystemPrompt?: string;
  /** Extra tools to allow without confirmation, e.g. `run_shell_command(git log)`. */
  allowedTools?: string[];
}

/**
 * Read-only commands a `plan` run may still execute. Plan mode otherwise has no shell, so
 * Qwen could not read a branch or a PR and the caller had to copy the code into the
 * working directory first (seen 2026-11-27). Prefix matches, as Qwen Code checks them.
 */
export const PLAN_READ_ONLY_COMMANDS = [
  'git log',
  'git show',
  'git diff',
  'git status',
  'git blame',
  'git ls-files',
  'git branch',
  'gh pr view',
  'gh pr diff',
] as const;

/**
 * Build the Qwen Code command line for one headless run. The prompt is not
 * part of it: it goes to stdin. `--model` is added at most once, because
 * Qwen Code 0.28.0 crashes when it is given twice.
 */
// The allow-list matches the start of the command, so `git -C <dir> log` is refused
// while `git log` is allowed. Tell the model; widening the list to `git -C` would
// also allow `git -C <dir> push`.
export const PLAN_SHELL_HINT =
  'Shell commands: run git and gh from the working directory exactly as `git log`, ' +
  '`git diff`, `gh pr view` and so on. Never use `git -C <dir>`, `cd <dir> &&` or other ' +
  'prefixes: only commands that start with an allowed read-only command are permitted.';

export function buildQwenArgs(input: QwenArgsInput): string[] {
  const args = ['--output-format', 'json'];
  if (input.authType) args.push('--auth-type', input.authType);
  if (input.model) args.push('--model', input.model);
  // Plan mode refuses every command Qwen Code cannot classify as read-only, whatever the
  // allow-list says (tested 2026-11-27: `date` with allowedTools was refused). A plan
  // call with extra tools therefore runs in `default` mode: nobody can approve an edit
  // in a headless run, so it still cannot change files, and the shell is limited to the
  // read-only commands below plus the caller's extra tools.
  const extra = input.allowedTools ?? [];
  const mode =
    input.approvalMode === 'plan' && extra.length > 0
      ? 'default'
      : input.approvalMode;
  args.push('--approval-mode', mode);
  const allowed = [
    ...(input.approvalMode === 'plan'
      ? PLAN_READ_ONLY_COMMANDS.map((c) => `run_shell_command(${c})`)
      : []),
    ...extra,
  ];
  for (const tool of allowed) args.push('--allowed-tools', tool);
  args.push('--max-wall-time', input.maxWallTime);
  args.push(input.resume ? '--resume' : '--session-id', input.qwenSessionId);
  const system = [
    input.approvalMode === 'plan' ? PLAN_SHELL_HINT : '',
    input.appendSystemPrompt ?? '',
  ].filter(Boolean);
  if (system.length) args.push('--append-system-prompt', system.join('\n\n'));
  return args;
}

export interface QwenOutput {
  /** False when stdout was not the expected JSON event array. */
  parsed: boolean;
  /** Final assistant text, or raw stdout when parsing failed. */
  text: string;
  isError: boolean;
  errorMessage?: string;
  sessionId?: string;
  model?: string;
  permissionMode?: string;
  durationMs?: number;
  numTurns?: number;
  usage?: Record<string, unknown>;
}

type Event = Record<string, unknown>;

const isRecord = (v: unknown): v is Event =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === 'number' ? v : undefined;

function assistantText(event: Event): string {
  const message = isRecord(event.message) ? event.message : {};
  const content = Array.isArray(message.content) ? message.content : [];
  return content
    .filter((block) => isRecord(block) && block.type === 'text')
    .map((block) => str((block as Event).text) ?? '')
    .join('');
}

/**
 * Parse the output of `qwen --output-format json`: one JSON array of events
 * (`system`/init, `assistant` messages, and a final `result`). Anything else
 * is returned as raw text.
 */
export function parseQwenOutput(stdout: string): QwenOutput {
  const raw = stdout.trim();
  let events: Event[];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error('not an event array');
    events = data.filter(isRecord);
  } catch {
    return { parsed: false, text: raw, isError: false };
  }

  const init = events.find((e) => e.type === 'system' && e.subtype === 'init');
  const result = events.findLast((e) => e.type === 'result');
  const lastAssistant = events
    .filter((e) => e.type === 'assistant')
    .map(assistantText)
    .findLast((text) => text.trim() !== '');

  const error = result && isRecord(result.error) ? result.error : undefined;

  return {
    parsed: true,
    text: str(result?.result) ?? lastAssistant ?? '',
    isError: result?.is_error === true,
    errorMessage: str(error?.message),
    sessionId: str(result?.session_id) ?? str(init?.session_id),
    model: str(init?.model),
    permissionMode: str(init?.permission_mode),
    durationMs: num(result?.duration_ms),
    numTurns: num(result?.num_turns),
    usage: result && isRecord(result.usage) ? result.usage : undefined,
  };
}

/** Remove secret values from text before it is returned or logged. */
export function scrub(
  text: string,
  secrets: Array<string | undefined>
): string {
  let clean = text;
  for (const secret of secrets) {
    if (secret) clean = clean.split(secret).join('[REDACTED]');
  }
  return clean;
}

/** The last `max` characters of a text, on whole lines where possible. */
export function tail(text: string, max = 1500): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(-max);
  const newline = cut.indexOf('\n');
  return `…${newline >= 0 && newline < 200 ? cut.slice(newline + 1) : cut}`;
}
