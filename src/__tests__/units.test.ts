import { durationToMs, loadConfig } from '../config';
import { InMemorySessionStorage } from '../session/storage';
import { runCommand } from '../utils/command';
import {
  buildQwenArgs,
  PLAN_SHELL_HINT,
  parseQwenOutput,
  scrub,
  tail,
} from '../utils/qwen';
import { buildToolDefinitions } from '../tools/definitions';
import { createFakeQwen } from './fake-qwen';

describe('loadConfig', () => {
  test('defaults', () => {
    expect(loadConfig({})).toEqual({
      bin: 'qwen',
      apiKeyFile: undefined,
      apiKeyEnv: [],
      baseUrl: undefined,
      authType: undefined,
      defaultModel: undefined,
      approvalMode: 'plan',
      maxWallTime: '15m',
    });
  });

  test('auth type defaults to openai only with a key file', () => {
    expect(loadConfig({ QWEN_MCP_API_KEY_FILE: '/k' }).authType).toBe('openai');
    expect(
      loadConfig({ QWEN_MCP_API_KEY_FILE: '/k', QWEN_MCP_AUTH_TYPE: 'gemini' })
        .authType
    ).toBe('gemini');
  });

  test('rejects bad values', () => {
    expect(() =>
      loadConfig({ QWEN_MCP_API_KEY_ENV: 'OK_NAME,bad-name' })
    ).toThrow(/invalid variable name/);
    expect(() => loadConfig({ QWEN_MCP_MAX_WALL_TIME: 'later' })).toThrow(
      /QWEN_MCP_MAX_WALL_TIME/
    );
  });
});

test('durationToMs', () => {
  expect(durationToMs('90')).toBe(90_000);
  expect(durationToMs('30s')).toBe(30_000);
  expect(durationToMs('5m')).toBe(300_000);
  expect(durationToMs('1.5h')).toBe(5_400_000);
  expect(() => durationToMs('500ms')).toThrow();
});

test('buildQwenArgs uses --session-id for a new session and --resume after', () => {
  const base = {
    qwenSessionId: 'abc',
    approvalMode: 'plan' as const,
    maxWallTime: '15m',
  };
  expect(
    buildQwenArgs({ ...base, approvalMode: 'yolo', resume: false })
  ).toEqual([
    '--output-format',
    'json',
    '--approval-mode',
    'yolo',
    '--max-wall-time',
    '15m',
    '--session-id',
    'abc',
  ]);
  const resumed = buildQwenArgs({ ...base, resume: true, model: 'm' });
  expect(resumed).toContain('--resume');
  expect(resumed).not.toContain('--session-id');
  expect(resumed.filter((arg) => arg === '--model')).toHaveLength(1);
});

test('plan mode may run read-only git commands, and nothing else by default', () => {
  const base = { qwenSessionId: 'abc', maxWallTime: '15m', resume: false };
  const allowed = (args: string[]) =>
    args.flatMap((arg, i) => (arg === '--allowed-tools' ? [args[i + 1]] : []));
  const mode = (args: string[]) => args[args.indexOf('--approval-mode') + 1];
  const plan = allowed(buildQwenArgs({ ...base, approvalMode: 'plan' }));
  expect(plan).toContain('run_shell_command(git diff)');
  // Qwen Code cannot classify gh as read-only and refuses it in plan mode
  expect(plan.some((t) => t.includes('gh '))).toBe(false);
  // git branch can create and delete branches
  expect(
    plan.some((t) => /git (push|commit|checkout|reset|branch)/.test(t))
  ).toBe(false);
  expect(allowed(buildQwenArgs({ ...base, approvalMode: 'yolo' }))).toEqual([]);
  // allowedTools never changes the mode: plan stays plan, with its read-only check
  const withExtra = buildQwenArgs({
    ...base,
    approvalMode: 'plan',
    allowedTools: ['run_shell_command(npm test)'],
  });
  expect(mode(withExtra)).toBe('plan');
  expect(allowed(withExtra)).toContain('run_shell_command(npm test)');
  expect(allowed(withExtra)).toContain('run_shell_command(git log)');
  // in default mode only the caller's tools are pre-approved, not the git prefixes
  const dflt = buildQwenArgs({
    ...base,
    approvalMode: 'default',
    allowedTools: ['run_shell_command(npm test)'],
  });
  expect(mode(dflt)).toBe('default');
  expect(allowed(dflt)).toEqual(['run_shell_command(npm test)']);
});

test('plan mode tells the model not to prefix git commands', () => {
  const base = { qwenSessionId: 'abc', maxWallTime: '15m', resume: false };
  const prompt = (args: string[]) =>
    args[args.indexOf('--append-system-prompt') + 1];
  const plan = buildQwenArgs({ ...base, approvalMode: 'plan' });
  expect(prompt(plan)).toBe(PLAN_SHELL_HINT);
  expect(PLAN_SHELL_HINT).toContain('git -C');
  const both = buildQwenArgs({
    ...base,
    approvalMode: 'plan',
    appendSystemPrompt: 'Be brief.',
  });
  expect(prompt(both)).toBe(`${PLAN_SHELL_HINT}\n\nBe brief.`);
  expect(buildQwenArgs({ ...base, approvalMode: 'yolo' })).not.toContain(
    '--append-system-prompt'
  );
});

describe('parseQwenOutput', () => {
  const init = {
    type: 'system',
    subtype: 'init',
    session_id: 'sid',
    model: 'm',
    permission_mode: 'plan',
  };
  const assistant = (text: string) => ({
    type: 'assistant',
    message: { content: [{ type: 'text', text }] },
  });

  test('reads the result event', () => {
    const output = parseQwenOutput(
      JSON.stringify([
        init,
        assistant('draft'),
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          session_id: 'sid',
          result: 'final',
          duration_ms: 5,
          num_turns: 2,
          usage: { total_tokens: 9 },
        },
      ])
    );
    expect(output).toEqual({
      parsed: true,
      text: 'final',
      isError: false,
      errorMessage: undefined,
      sessionId: 'sid',
      model: 'm',
      permissionMode: 'plan',
      durationMs: 5,
      numTurns: 2,
      usage: { total_tokens: 9 },
    });
  });

  test('reads an error result', () => {
    const output = parseQwenOutput(
      JSON.stringify([
        init,
        { type: 'result', is_error: true, error: { message: 'bad key' } },
      ])
    );
    expect(output.isError).toBe(true);
    expect(output.errorMessage).toBe('bad key');
  });

  test('uses the last non-empty assistant text without a result', () => {
    const output = parseQwenOutput(
      JSON.stringify([
        init,
        assistant('first'),
        assistant('second'),
        assistant(''),
      ])
    );
    expect(output.text).toBe('second');
  });

  test('returns raw text for anything that is not an event array', () => {
    expect(parseQwenOutput('  hello\n')).toEqual({
      parsed: false,
      text: 'hello',
      isError: false,
    });
    expect(parseQwenOutput('{"a":1}').parsed).toBe(false);
    expect(parseQwenOutput('').text).toBe('');
  });
});

test('scrub and tail', () => {
  expect(scrub('a KEY b KEY', ['KEY', undefined, ''])).toBe(
    'a [REDACTED] b [REDACTED]'
  );
  expect(tail('short')).toBe('short');
  expect(tail(`first line\n${'x'.repeat(40)}`, 45)).toBe(`…${'x'.repeat(40)}`);
});

describe('InMemorySessionStorage', () => {
  test('records turns and replaces the mapping for a new Qwen session', () => {
    const storage = new InMemorySessionStorage();
    storage.recordTurn('s', 'q1', '/a');
    storage.recordTurn('s', 'q1', '/a');
    expect(storage.get('s')).toMatchObject({ qwenSessionId: 'q1', turns: 2 });
    storage.recordTurn('s', 'q2', '/b');
    expect(storage.get('s')).toMatchObject({
      qwenSessionId: 'q2',
      cwd: '/b',
      turns: 1,
    });
    expect(storage.delete('s')).toBe(true);
    expect(storage.get('s')).toBeUndefined();
  });

  test('keeps at most maxSessions and drops expired ones', async () => {
    const limited = new InMemorySessionStorage(2);
    for (const id of ['a', 'b', 'c']) {
      limited.recordTurn(id, `q-${id}`, '/');
      await new Promise((resolve) => setTimeout(resolve, 3));
    }
    expect(limited.list().map((s) => s.id)).toEqual(['c', 'b']);

    const expiring = new InMemorySessionStorage(100, 1);
    expiring.recordTurn('old', 'q', '/');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(expiring.get('old')).toBeUndefined();
  });
});

describe('runCommand', () => {
  test('kills a run that passes its hard timeout', async () => {
    const fake = createFakeQwen();
    const started = Date.now();
    const result = await runCommand(fake.bin, [], {
      env: { FAKE_QWEN_MODE: 'hang', FAKE_QWEN_DIR: fake.dir },
      stdin: 'x',
      timeoutMs: 300,
    });
    expect(result.timedOut).toBe(true);
    expect(result.code).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  test('stops a run when the request is aborted', async () => {
    const fake = createFakeQwen();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const result = await runCommand(fake.bin, [], {
      env: { FAKE_QWEN_MODE: 'hang', FAKE_QWEN_DIR: fake.dir },
      stdin: 'x',
      signal: controller.signal,
    });
    expect(result.aborted).toBe(true);
    expect(result.timedOut).toBe(false);
  });
});

test('the tool description names the configured default approval mode', () => {
  const describe = (mode: 'plan' | 'yolo') => {
    const [qwen] = buildToolDefinitions(mode);
    const props = qwen.inputSchema.properties as Record<
      string,
      { description: string }
    >;
    return `${qwen.description} ${props.approvalMode.description}`;
  };
  expect(describe('plan')).toContain('"plan" (read-only');
  expect(describe('yolo')).toContain('"yolo" (EVERYTHING is approved');
  expect(describe('yolo')).not.toContain('"plan" (read-only');
});
