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
import { toolDefinitions } from './tools/definitions.js';
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
      return { tools: toolDefinitions };
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
    await this.server.connect(transport);
    console.error(`${this.config.name} started successfully`);
  }
}
