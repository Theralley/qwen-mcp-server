import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createFakeQwen, flagValue } from './fake-qwen';

type TextResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

// Drives the built server (dist/, built by `pretest`) over stdio.
describe('MCP stdio integration', () => {
  jest.setTimeout(20000);

  const fake = createFakeQwen();
  let client: Client;

  beforeAll(async () => {
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [path.join(process.cwd(), 'dist', 'index.js')],
        env: {
          PATH: process.env.PATH ?? '',
          QWEN_MCP_BIN: fake.bin,
          FAKE_QWEN_DIR: fake.dir,
        },
        stderr: 'ignore',
      })
    );
  });

  afterAll(async () => {
    await client.close();
  });

  const call = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args }) as Promise<TextResult>;

  test('lists the four tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'help',
      'listSessions',
      'ping',
      'qwen',
    ]);
  });

  test('ping and help', async () => {
    expect((await call('ping')).content[0].text).toBe('pong');
    expect((await call('ping', { message: 'hi' })).content[0].text).toBe('hi');
    expect((await call('help', { command: 'version' })).content[0].text).toBe(
      '0.0.0-fake'
    );
    expect((await call('help')).content[0].text).toBe('Usage: fake qwen');
  });

  test('qwen runs and resumes through the protocol', async () => {
    const first = await call('qwen', { prompt: 'one', sessionId: 'it' });
    const second = await call('qwen', { prompt: 'two', sessionId: 'it' });
    const [a, b] = fake.calls();

    expect(first.content[0].text).toBe('echo: one');
    expect(second.content[0].text).toBe('echo: two');
    expect(flagValue(b.argv, '--resume')).toBe(
      flagValue(a.argv, '--session-id')
    );
  });

  test('errors come back as isError results', async () => {
    const bad = await call('qwen', {});
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/Validation failed for tool "qwen"/);

    const unknown = await call('nope');
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0].text).toMatch(/Unknown tool: nope/);
  });
});
