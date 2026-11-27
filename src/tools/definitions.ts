import {
  APPROVAL_MODES,
  TOOLS,
  type ApprovalModeName,
  type ToolDefinition,
} from '../types.js';

const MODE_SUMMARY: Record<ApprovalModeName, string> = {
  plan: 'read-only: Qwen reads and analyzes, never edits files',
  default: 'edits and commands need approval, which a headless run cannot give',
  'auto-edit': 'file edits are approved automatically',
  auto: 'a classifier approves actions it judges safe',
  yolo: 'EVERYTHING is approved, including edits and any shell command',
};

/**
 * The tool list, with the default approval mode the server is actually configured
 * with, so a client is never told "read-only" by a server whose operator chose yolo.
 */
export function buildToolDefinitions(
  defaultMode: ApprovalModeName
): ToolDefinition[] {
  return [
    {
      name: TOOLS.QWEN,
      description: `Ask Qwen Code (the Qwen Code CLI, run headlessly) a question or give it a task. Default approval mode on this server: "${defaultMode}" (${MODE_SUMMARY[defaultMode]}); pass approvalMode to change it per call.`,
      inputSchema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'The coding task, question, or analysis request',
          },
          sessionId: {
            type: 'string',
            description:
              'Optional caller-chosen ID for a multi-turn conversation. Calls with the same ID continue the same Qwen session, in the working directory of the first call.',
          },
          resetSession: {
            type: 'boolean',
            description:
              'Forget the Qwen session behind sessionId and start a fresh one with this request',
          },
          model: {
            type: 'string',
            description:
              'Model to use (defaults to QWEN_MCP_DEFAULT_MODEL, else Qwen Code’s own default)',
          },
          approvalMode: {
            type: 'string',
            enum: [...APPROVAL_MODES],
            description: `Defaults to "${defaultMode}" on this server. plan: analyze only, no edits; the only shell commands are read-only git (log, show, diff, status, blame, ls-files), run from the working directory. default: edits and commands need approval, and a headless run has nobody to give it, so only allowedTools run. auto-edit: file edits approved. auto: a classifier approves safe actions. yolo: everything approved.`,
          },
          allowedTools: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Extra tools to allow without confirmation, in Qwen Code form, e.g. "run_shell_command(npm test)". Prefix matches. Plan mode still refuses anything it cannot classify as read-only; to run other commands without edits, use approvalMode "default" with this list.',
          },
          workingDirectory: {
            type: 'string',
            description:
              'Directory to run Qwen Code in. Fixed by the first call of a session.',
          },
          maxWallTime: {
            type: 'string',
            description:
              'Wall-clock budget for this run, e.g. 90, 30s, 5m, 1.5h (defaults to QWEN_MCP_MAX_WALL_TIME, else 15m)',
          },
          appendSystemPrompt: {
            type: 'string',
            description: 'Extra instructions appended to the system prompt',
          },
        },
        required: ['prompt'],
      },
      annotations: {
        title: 'Run Qwen Code',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    {
      name: TOOLS.LIST_SESSIONS,
      description:
        'List the active conversation sessions with their Qwen session IDs and working directories',
      inputSchema: { type: 'object', properties: {}, required: [] },
      annotations: {
        title: 'List Sessions',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: TOOLS.PING,
      description: 'Test MCP server connection',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Message to echo back' },
        },
        required: [],
      },
      annotations: {
        title: 'Ping Server',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: TOOLS.HELP,
      description: 'Get the Qwen Code CLI help text or installed version',
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            enum: ['version'],
            description: 'Pass "version" for the installed version only',
          },
        },
        required: [],
      },
      annotations: {
        title: 'Get Help',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ];
}
