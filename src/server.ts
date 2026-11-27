import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  type ProgressToken,
  type ServerConfig,
  type ToolHandlerContext,
  type ToolName,
  TOOLS,
} from './types.js';
import { handleError } from './errors.js';
import { buildToolDefinitions } from './tools/definitions.js';
import { DEFAULT_APPROVAL_MODE, loadConfig } from './config.js';
import { killAll } from './utils/command.js';
import { toolHandlers } from './tools/handlers.js';

export class QwenMcpServer {
  private readonly server: Server;
  private readonly config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
    this.server = new Server(
      { name: config.name, version: config.version },
      { capabilities: { tools: {} } }
    );
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      let mode = DEFAULT_APPROVAL_MODE;
      try {
        mode = loadConfig().approvalMode;
      } catch {
        // A configuration error is reported by the tool call itself.
      }
      return { tools: buildToolDefinitions(mode) };
    });

    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request, extra) => {
        const { name, arguments: args } = request.params;
        const progressToken = request.params._meta?.progressToken as
          ProgressToken | undefined;

        let progressCount = 0;
        const context: ToolHandlerContext = {
          progressToken,
          signal: extra.signal,
          sendProgress: async (message: string) => {
            if (progressToken === undefined) return;
            progressCount++;
            try {
              await extra.sendNotification({
                method: 'notifications/progress',
                params: { progressToken, progress: progressCount, message },
              });
            } catch {
              // A failed progress notification must not fail the tool call.
            }
          },
        };

        try {
          if (!this.isValidToolName(name)) {
            throw new Error(`Unknown tool: ${name}`);
          }
          return await toolHandlers[name].execute(args ?? {}, context);
        } catch (error) {
          return {
            content: [
              { type: 'text', text: handleError(error, `tool "${name}"`) },
            ],
            isError: true,
          };
        }
      }
    );
  }

  private isValidToolName(name: string): name is ToolName {
    return Object.values(TOOLS).includes(name as ToolName);
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    // When the client goes away (it closes our stdin), stop any Qwen run it started
    // instead of waiting for it. The SDK's stdio transport does not watch for this.
    const shutdown = () => {
      killAll();
      process.exit(0);
    };
    this.server.onclose = shutdown;
    process.stdin.once('end', shutdown);
    process.stdin.once('close', shutdown);
    await this.server.connect(transport);
    console.error(`${this.config.name} started successfully`);
  }
}
