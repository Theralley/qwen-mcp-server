import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * A stand-in for the `qwen` executable. It records each call (argv, stdin,
 * cwd and the auth-related environment) to `call-N.json` in FAKE_QWEN_DIR and
 * answers according to FAKE_QWEN_MODE.
 */
const FAKE_QWEN_SOURCE = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
const mode = process.env.FAKE_QWEN_MODE || 'ok';
const dir = process.env.FAKE_QWEN_DIR;

if (argv.includes('--version')) { console.log('0.0.0-fake'); process.exit(0); }
if (argv.includes('--help')) { console.log('Usage: fake qwen'); process.exit(0); }

let stdin = '';
process.stdin.on('data', (d) => (stdin += d));
process.stdin.on('end', () => {
  const n = fs.readdirSync(dir).filter((f) => f.startsWith('call-')).length;
  const env = {};
  for (const k of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'EXTRA_KEY_ONE', 'EXTRA_KEY_TWO'])
    env[k] = process.env[k];
  fs.writeFileSync(
    path.join(dir, 'call-' + n + '.json'),
    JSON.stringify({ argv, stdin, cwd: process.cwd(), env })
  );

  const flag = (name) => argv[argv.indexOf(name) + 1];
  const sid = argv.includes('--resume') ? flag('--resume') : flag('--session-id');
  const key = process.env.OPENAI_API_KEY;
  const events = (result) => JSON.stringify([
    { type: 'system', subtype: 'init', session_id: sid, model: flag('--model') || 'fake-default', permission_mode: flag('--approval-mode') },
    { type: 'assistant', session_id: sid, message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }] } },
    { type: 'assistant', session_id: sid, message: { role: 'assistant', content: [{ type: 'text', text: 'assistant text' }] } },
    Object.assign({ type: 'result', session_id: sid, duration_ms: 12, num_turns: 1, usage: { input_tokens: 3, output_tokens: 4 } }, result),
  ]);
  const ok = () => { console.log(events({ subtype: 'success', is_error: false, result: 'echo: ' + stdin })); process.exit(0); };

  switch (mode) {
    case 'ok': return ok();
    case 'text': console.log('plain text answer'); return process.exit(0);
    case 'no-result': console.log(JSON.stringify(JSON.parse(events({})).slice(0, 3))); return process.exit(0);
    case 'exit1': console.error('boom on stderr'); return process.exit(1);
    case 'budget':
      console.error(JSON.stringify({ error: { type: 'FatalBudgetExceededError', message: 'wall-clock budget exceeded', code: 55 } }));
      return process.exit(55);
    case 'api-error':
      console.log(events({ subtype: 'error_during_execution', is_error: true, error: { message: 'API Error: 401 for key ' + key } }));
      console.error('auth failed with ' + key);
      return process.exit(1);
    case 'error-exit0':
      console.log(events({ subtype: 'error_during_execution', is_error: true, error: { message: 'soft failure' } }));
      return process.exit(0);
    case 'no-resume':
      if (!argv.includes('--resume')) return ok();
      console.error('No saved session found with ID ' + sid + '.');
      return process.exit(1);
    case 'hang': return void setInterval(() => {}, 1000);
    default: console.error('unknown mode ' + mode); process.exit(2);
  }
});
`;

export interface FakeCall {
  argv: string[];
  stdin: string;
  cwd: string;
  env: Record<string, string | undefined>;
}

export interface FakeQwen {
  /** Path of the fake executable, for QWEN_MCP_BIN. */
  bin: string;
  /** Directory the calls are recorded in, for FAKE_QWEN_DIR. */
  dir: string;
  calls: () => FakeCall[];
}

export function createFakeQwen(): FakeQwen {
  const dir = mkdtempSync(path.join(tmpdir(), 'qwen-mcp-test-'));
  const bin = path.join(dir, 'qwen');
  writeFileSync(bin, FAKE_QWEN_SOURCE, { mode: 0o755 });
  return {
    bin,
    dir,
    calls: () =>
      readdirSync(dir)
        .filter((file) => file.startsWith('call-'))
        .sort((a, b) => Number(a.slice(5, -5)) - Number(b.slice(5, -5)))
        .map(
          (file) =>
            JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as FakeCall
        ),
  };
}

/** The value following a flag in an argv list. */
export function flagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}
