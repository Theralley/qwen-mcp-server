#!/usr/bin/env node
// End-to-end check against a real Qwen Code install: ping, then two turns on
// one session to prove that resume works. Uses the QWEN_MCP_* variables of
// the calling environment. Build first (npm run build), then:
//
//   QWEN_MCP_API_KEY_FILE=/path/to/api.key QWEN_MCP_BASE_URL=... node scripts/e2e.mjs
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const serverPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist',
  'index.js'
);
const workingDirectory = mkdtempSync(path.join(tmpdir(), 'qwen-mcp-e2e-'));

const client = new Client({ name: 'qwen-mcp-e2e', version: '0.0.0' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: process.env,
    stderr: 'ignore',
  })
);

let failed = false;
async function call(name, args) {
  const started = Date.now();
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 10 * 60 * 1000,
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const text = result.content?.[0]?.text ?? '';
  console.log(`\n> ${name} ${JSON.stringify(args)}`);
  console.log(`< [${seconds}s${result.isError ? ', ERROR' : ''}] ${text}`);
  const meta = result.content?.[0]?._meta;
  if (meta) console.log(`  meta: ${JSON.stringify(meta)}`);
  if (result.isError) failed = true;
  return text;
}

const sessionId = `e2e-${Date.now()}`;
const common = { sessionId, approvalMode: 'plan', maxWallTime: '3m' };

await call('ping', {});
await call('help', { command: 'version' });
const first = await call('qwen', {
  ...common,
  workingDirectory,
  prompt: 'Reply with exactly: PONG-1',
});
const second = await call('qwen', {
  ...common,
  prompt:
    'What exactly did you reply to my previous message? Answer with that reply only.',
});
await call('listSessions', {});
await client.close();

const ok = !failed && first.includes('PONG-1') && second.includes('PONG-1');
console.log(`\n${ok ? 'PASS' : 'FAIL'}: two-turn resume`);
process.exit(ok ? 0 : 1);
