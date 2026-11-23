#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { QwenMcpServer } from './server.js';

const SERVER_CONFIG = {
  name: 'qwen-mcp-server',
  version: (
    JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as { version: string }
  ).version,
} as const;

async function main(): Promise<void> {
  try {
    const server = new QwenMcpServer(SERVER_CONFIG);
    await server.start();
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();
