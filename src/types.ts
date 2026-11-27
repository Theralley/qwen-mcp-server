import { z } from 'zod';

export const TOOLS = {
  QWEN: 'qwen',
  LIST_SESSIONS: 'listSessions',
  PING: 'ping',
  HELP: 'help',
} as const;

export type ToolName = (typeof TOOLS)[keyof typeof TOOLS];

export const APPROVAL_MODES = [
  'plan',
  'default',
  'auto-edit',
  'auto',
  'yolo',
] as const;
export const ApprovalMode = z.enum(APPROVAL_MODES);
export type ApprovalModeName = z.infer<typeof ApprovalMode>;

/** Seconds (`90`) or a number with a unit (`30s`, `5m`, `1.5h`), as Qwen Code accepts. */
export const DURATION_PATTERN = /^(\d+(?:\.\d+)?)(s|m|h)?$/;

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: ToolName;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
  annotations?: ToolAnnotations;
}

export interface ToolResult {
  content: Array<{
    type: 'text';
    text: string;
    _meta?: Record<string, unknown>;
  }>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

export interface ServerConfig {
  name: string;
  version: string;
}

export const QwenToolSchema = z.object({
  prompt: z.string().min(1, { error: 'prompt cannot be empty' }),
  sessionId: z
    .string()
    .min(1)
    .max(256, { error: 'Session ID must be 256 characters or fewer' })
    .regex(/^[a-zA-Z0-9_-]+$/, {
      error:
        'Session ID can only contain letters, numbers, hyphens, and underscores',
    })
    .optional(),
  resetSession: z.boolean().optional(),
  model: z.string().min(1).optional(),
  approvalMode: ApprovalMode.optional(),
  workingDirectory: z.string().min(1).optional(),
  maxWallTime: z
    .string()
    .regex(DURATION_PATTERN, {
      error: 'maxWallTime must look like 90, 30s, 5m or 1.5h',
    })
    .optional(),
  appendSystemPrompt: z.string().min(1).optional(),
  allowedTools: z.array(z.string().min(1).max(200)).max(20).optional(),
});

export const PingToolSchema = z.object({
  message: z.string().optional(),
});

export const HelpToolSchema = z.object({
  command: z.enum(['version']).optional(),
});

export const ListSessionsToolSchema = z.object({});

export type QwenToolArgs = z.infer<typeof QwenToolSchema>;

export type ProgressToken = string | number;

/** Context passed to tool handlers. */
export interface ToolHandlerContext {
  progressToken?: ProgressToken;
  sendProgress: (message: string) => Promise<void>;
  /** Aborted when the MCP client cancels the request. */
  signal?: AbortSignal;
}
