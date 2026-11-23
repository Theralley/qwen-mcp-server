import { APPROVAL_MODES, TOOLS, type ToolDefinition } from '../types.js';

export const toolDefinitions: ToolDefinition[] = [
  {
    name: TOOLS.QWEN,
    description:
      'Run the Qwen Code CLI non-interactively for AI assistance. Read-only (approval mode "plan") unless configured or asked otherwise.',
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
          description:
            'plan: analyze only, no edits or commands (default). default: edits and commands need approval, and a headless run has nobody to give it. auto-edit: file edits approved. auto: a classifier approves safe actions. yolo: everything approved.',
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
