import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InMemorySessionStorage } from '../session/storage';
import { ListSessionsToolHandler, QwenToolHandler } from '../tools/handlers';
import { createFakeQwen, flagValue, type FakeQwen } from './fake-qwen';

const SECRET = 'sk-test-SECRET-value-123';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('qwen tool', () => {
  const savedEnv = { ...process.env };
  let fake: FakeQwen;
  let storage: InMemorySessionStorage;
  let handler: QwenToolHandler;

  beforeEach(() => {
    process.env = Object.fromEntries(
      Object.entries(savedEnv).filter(
        ([name]) => !/^(QWEN_MCP_|FAKE_QWEN_|OPENAI_)/.test(name)
      )
    );
    fake = createFakeQwen();
    process.env.QWEN_MCP_BIN = fake.bin;
    process.env.FAKE_QWEN_DIR = fake.dir;
    storage = new InMemorySessionStorage();
    handler = new QwenToolHandler(storage);
  });

  afterEach(() => {
    rmSync(fake.dir, { recursive: true, force: true });
    process.env = { ...savedEnv };
  });

  const useKeyFile = (): string => {
    const keyFile = path.join(fake.dir, 'api.key');
    writeFileSync(keyFile, `${SECRET}\n`, { mode: 0o600 });
    process.env.QWEN_MCP_API_KEY_FILE = keyFile;
    return keyFile;
  };

  describe('argv', () => {
    test('defaults: json output, plan mode, 15m, new session, no model or auth type', async () => {
      await handler.execute({ prompt: 'hello' });
      const [{ argv, stdin }] = fake.calls();

      expect(flagValue(argv, '--output-format')).toBe('json');
      expect(flagValue(argv, '--approval-mode')).toBe('plan');
      expect(flagValue(argv, '--max-wall-time')).toBe('15m');
      expect(flagValue(argv, '--session-id')).toMatch(UUID);
      expect(argv).not.toContain('--resume');
      expect(argv).not.toContain('--model');
      expect(argv).not.toContain('--auth-type');
      // The prompt travels on stdin only.
      expect(stdin).toBe('hello');
      expect(argv).not.toContain('hello');
    });

    test('model is passed exactly once, argument over default', async () => {
      process.env.QWEN_MCP_DEFAULT_MODEL = 'default-model';
      await handler.execute({ prompt: 'a' });
      await handler.execute({ prompt: 'b', model: 'chosen-model' });
      const [first, second] = fake.calls().map((call) => call.argv);

      expect(first.filter((arg) => arg === '--model')).toHaveLength(1);
      expect(flagValue(first, '--model')).toBe('default-model');
      expect(second.filter((arg) => arg === '--model')).toHaveLength(1);
      expect(flagValue(second, '--model')).toBe('chosen-model');
      expect(second).not.toContain('default-model');
    });

    test('per-call options and environment defaults', async () => {
      process.env.QWEN_MCP_APPROVAL_MODE = 'auto-edit';
      process.env.QWEN_MCP_MAX_WALL_TIME = '90';
      process.env.QWEN_MCP_AUTH_TYPE = 'anthropic';
      await handler.execute({ prompt: 'a' });
      await handler.execute({
        prompt: 'b',
        approvalMode: 'yolo',
        maxWallTime: '2m',
        appendSystemPrompt: 'Be brief.',
      });
      const [first, second] = fake.calls().map((call) => call.argv);

      expect(flagValue(first, '--approval-mode')).toBe('auto-edit');
      expect(flagValue(first, '--max-wall-time')).toBe('90');
      expect(flagValue(first, '--auth-type')).toBe('anthropic');
      expect(first).not.toContain('--append-system-prompt');
      expect(flagValue(second, '--approval-mode')).toBe('yolo');
      expect(flagValue(second, '--max-wall-time')).toBe('2m');
      expect(flagValue(second, '--append-system-prompt')).toBe('Be brief.');
    });

    test('plan mode refuses allowedTools other than shell commands, before running', async () => {
      const error = await handler
        .execute({
          prompt: 'a',
          approvalMode: 'plan',
          allowedTools: ['write_file'],
        })
        .catch((e) => e);
      expect(error.message).toMatch(/may only list shell commands/);
      expect(error.message).toMatch(/write_file/);
      expect(fake.calls()).toHaveLength(0);
      // shell commands are fine in plan, any tool is fine in other modes
      await handler.execute({
        prompt: 'b',
        approvalMode: 'plan',
        allowedTools: ['run_shell_command(npm test)'],
      });
      await handler.execute({
        prompt: 'c',
        approvalMode: 'auto-edit',
        allowedTools: ['write_file'],
      });
      expect(fake.calls()).toHaveLength(2);
    });

    test('rejects invalid arguments and configuration before running', async () => {
      await expect(handler.execute({ prompt: '' })).rejects.toThrow(
        /Validation failed/
      );
      await expect(
        handler.execute({ prompt: 'a', approvalMode: 'everything' })
      ).rejects.toThrow(/Validation failed/);
      await expect(
        handler.execute({ prompt: 'a', maxWallTime: 'soon' })
      ).rejects.toThrow(/maxWallTime/);
      await expect(
        handler.execute({ prompt: 'a', sessionId: 'bad id!' })
      ).rejects.toThrow(/Session ID/);
      await expect(
        handler.execute({ prompt: 'a', workingDirectory: '/no/such/dir' })
      ).rejects.toThrow(/does not exist/);
      process.env.QWEN_MCP_APPROVAL_MODE = 'sometimes';
      await expect(handler.execute({ prompt: 'a' })).rejects.toThrow(
        /QWEN_MCP_APPROVAL_MODE/
      );
      expect(fake.calls()).toHaveLength(0);
    });
  });

  describe('API key', () => {
    test('key from file reaches the environment, never argv', async () => {
      useKeyFile();
      process.env.QWEN_MCP_API_KEY_ENV = 'EXTRA_KEY_ONE, EXTRA_KEY_TWO';
      process.env.QWEN_MCP_BASE_URL = 'https://example.invalid/v1';
      await handler.execute({ prompt: 'hello' });
      const [{ argv, env }] = fake.calls();

      expect(env.OPENAI_API_KEY).toBe(SECRET);
      expect(env.EXTRA_KEY_ONE).toBe(SECRET);
      expect(env.EXTRA_KEY_TWO).toBe(SECRET);
      expect(env.OPENAI_BASE_URL).toBe('https://example.invalid/v1');
      expect(argv.join(' ')).not.toContain(SECRET);
      // A key file implies the OpenAI-compatible auth type.
      expect(flagValue(argv, '--auth-type')).toBe('openai');
    });

    test('the key file is read again for every call', async () => {
      const keyFile = useKeyFile();
      await handler.execute({ prompt: 'a' });
      writeFileSync(keyFile, 'sk-rotated');
      await handler.execute({ prompt: 'b' });

      expect(fake.calls().map((call) => call.env.OPENAI_API_KEY)).toEqual([
        SECRET,
        'sk-rotated',
      ]);
    });

    test('without a key file nothing is set', async () => {
      await handler.execute({ prompt: 'hello' });
      const [{ env }] = fake.calls();
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.OPENAI_BASE_URL).toBeUndefined();
    });

    test('key is scrubbed from error text', async () => {
      useKeyFile();
      process.env.FAKE_QWEN_MODE = 'api-error';
      const error = await handler.execute({ prompt: 'hello' }).catch((e) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('API Error: 401 for key [REDACTED]');
      expect(error.message).toContain('auth failed with [REDACTED]');
      expect(error.message).not.toContain(SECRET);
    });

    test('a short key is scrubbed too', async () => {
      const keyFile = path.join(fake.dir, 'short.key');
      writeFileSync(keyFile, 'k3y\n', { mode: 0o600 });
      process.env.QWEN_MCP_API_KEY_FILE = keyFile;
      process.env.FAKE_QWEN_MODE = 'api-error';
      const error = await handler.execute({ prompt: 'hello' }).catch((e) => e);
      expect(error.message).toContain('401 for key [REDACTED]');
      expect(error.message).not.toContain('k3y');
    });

    test('a key the server inherited is scrubbed as well', async () => {
      process.env.OPENAI_API_KEY = SECRET;
      process.env.FAKE_QWEN_MODE = 'api-error';
      const error = await handler.execute({ prompt: 'hello' }).catch((e) => e);

      expect(error.message).toContain('[REDACTED]');
      expect(error.message).not.toContain(SECRET);
    });

    test('unreadable or empty key file is a clear error, and Qwen is not run', async () => {
      process.env.QWEN_MCP_API_KEY_FILE = path.join(fake.dir, 'missing.key');
      await expect(handler.execute({ prompt: 'a' })).rejects.toThrow(
        /cannot read QWEN_MCP_API_KEY_FILE.*ENOENT/
      );
      writeFileSync(path.join(fake.dir, 'missing.key'), '  \n');
      await expect(handler.execute({ prompt: 'a' })).rejects.toThrow(
        /is empty/
      );
      expect(fake.calls()).toHaveLength(0);
    });
  });

  describe('output', () => {
    test('returns the final result text with metadata', async () => {
      const result = await handler.execute({ prompt: 'hello', model: 'm-1' });
      const [{ argv }] = fake.calls();

      expect(result.content[0].text).toBe('echo: hello');
      expect(result.content[0]._meta).toMatchObject({
        qwenSessionId: flagValue(argv, '--session-id'),
        resumed: false,
        model: 'm-1',
        approvalMode: 'plan',
        durationMs: 12,
        numTurns: 1,
        usage: { input_tokens: 3, output_tokens: 4 },
      });
    });

    test('falls back to the last assistant text when there is no result event', async () => {
      process.env.FAKE_QWEN_MODE = 'no-result';
      const result = await handler.execute({ prompt: 'hello' });
      expect(result.content[0].text).toBe('assistant text');
    });

    test('falls back to raw stdout when the output is not JSON', async () => {
      process.env.FAKE_QWEN_MODE = 'text';
      const result = await handler.execute({ prompt: 'hello' });
      expect(result.content[0].text).toBe('plain text answer');
      expect(result.content[0]._meta).toMatchObject({ rawOutput: true });
    });
  });

  describe('sessions', () => {
    test('first call creates a Qwen session, later calls resume it', async () => {
      const first = await handler.execute({ prompt: 'one', sessionId: 's1' });
      const second = await handler.execute({ prompt: 'two', sessionId: 's1' });
      const [a, b] = fake.calls().map((call) => call.argv);

      const qwenSessionId = flagValue(a, '--session-id');
      expect(qwenSessionId).toMatch(UUID);
      expect(b).not.toContain('--session-id');
      expect(flagValue(b, '--resume')).toBe(qwenSessionId);
      expect(first.content[0]._meta).toMatchObject({
        sessionId: 's1',
        qwenSessionId,
        resumed: false,
      });
      expect(second.content[0]._meta).toMatchObject({
        sessionId: 's1',
        qwenSessionId,
        resumed: true,
      });
    });

    test('a session stays in the directory of its first call', async () => {
      const dirA = realpathSync(mkdtempSync(path.join(tmpdir(), 'qwen-a-')));
      const dirB = realpathSync(mkdtempSync(path.join(tmpdir(), 'qwen-b-')));
      try {
        await handler.execute({
          prompt: 'one',
          sessionId: 's1',
          workingDirectory: dirA,
        });
        await handler.execute({ prompt: 'two', sessionId: 's1' });
        expect(fake.calls().map((call) => call.cwd)).toEqual([dirA, dirA]);

        await expect(
          handler.execute({
            prompt: 'three',
            sessionId: 's1',
            workingDirectory: dirB,
          })
        ).rejects.toThrow(/can only be resumed from the directory/);
        expect(fake.calls()).toHaveLength(2);

        await handler.execute({
          prompt: 'four',
          sessionId: 's1',
          workingDirectory: dirB,
          resetSession: true,
        });
        const last = fake.calls()[2];
        expect(last.cwd).toBe(dirB);
        expect(last.argv).toContain('--session-id');
      } finally {
        rmSync(dirA, { recursive: true, force: true });
        rmSync(dirB, { recursive: true, force: true });
      }
    });

    test('resetSession starts a new Qwen session', async () => {
      await handler.execute({ prompt: 'one', sessionId: 's1' });
      await handler.execute({
        prompt: 'two',
        sessionId: 's1',
        resetSession: true,
      });
      const [a, b] = fake.calls().map((call) => call.argv);

      expect(b).not.toContain('--resume');
      expect(flagValue(b, '--session-id')).toMatch(UUID);
      expect(flagValue(b, '--session-id')).not.toBe(
        flagValue(a, '--session-id')
      );
    });

    test('a failed reset keeps the old session', async () => {
      await handler.execute({ prompt: 'one', sessionId: 's1' });
      const before = storage.get('s1')?.qwenSessionId;
      process.env.FAKE_QWEN_MODE = 'exit1';
      await expect(
        handler.execute({ prompt: 'two', sessionId: 's1', resetSession: true })
      ).rejects.toThrow();
      expect(storage.get('s1')?.qwenSessionId).toBe(before);
    });

    test('a failed resume is reported and does not start a fresh session', async () => {
      process.env.FAKE_QWEN_MODE = 'no-resume';
      await handler.execute({ prompt: 'one', sessionId: 's1' });
      const error = await handler
        .execute({ prompt: 'two', sessionId: 's1' })
        .catch((e) => e);
      const calls = fake.calls();

      expect(error.message).toMatch(/Could not resume Qwen session/);
      expect(error.message).toMatch(/resetSession: true/);
      expect(error.message).toMatch(/No saved session found/);
      expect(calls).toHaveLength(2);
      expect(calls[1].argv).not.toContain('--session-id');
      // The mapping is kept; only an explicit reset replaces it.
      expect(storage.get('s1')?.qwenSessionId).toBe(
        flagValue(calls[0].argv, '--session-id')
      );
    });

    test('a failed first call leaves no session behind', async () => {
      process.env.FAKE_QWEN_MODE = 'exit1';
      await expect(
        handler.execute({ prompt: 'one', sessionId: 's1' })
      ).rejects.toThrow();
      expect(storage.get('s1')).toBeUndefined();
    });

    test('calls on one session run one after another', async () => {
      await Promise.all([
        handler.execute({ prompt: 'one', sessionId: 's1' }),
        handler.execute({ prompt: 'two', sessionId: 's1' }),
      ]);
      const [a, b] = fake.calls();
      expect(a.stdin).toBe('one');
      expect(flagValue(b.argv, '--resume')).toBe(
        flagValue(a.argv, '--session-id')
      );
    });

    test('listSessions shows the mapping', async () => {
      const list = new ListSessionsToolHandler(storage);
      expect((await list.execute({})).content[0].text).toBe(
        'No active sessions'
      );
      await handler.execute({ prompt: 'one', sessionId: 's1' });
      await handler.execute({ prompt: 'two', sessionId: 's1' });
      const sessions = JSON.parse((await list.execute({})).content[0].text);

      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        sessionId: 's1',
        qwenSessionId: flagValue(fake.calls()[0].argv, '--session-id'),
        workingDirectory: process.cwd(),
        turnCount: 2,
      });
    });
  });

  describe('errors', () => {
    test('non-zero exit surfaces the exit code and stderr', async () => {
      process.env.FAKE_QWEN_MODE = 'exit1';
      await expect(handler.execute({ prompt: 'hello' })).rejects.toThrow(
        /exited with code 1[\s\S]*boom on stderr/
      );
    });

    test('exit code 55 is reported as an exceeded budget', async () => {
      process.env.FAKE_QWEN_MODE = 'budget';
      await expect(
        handler.execute({ prompt: 'hello', maxWallTime: '5s' })
      ).rejects.toThrow(
        /exceeded its run budget \(exit code 55; max wall time 5s\)[\s\S]*wall-clock budget exceeded/
      );
    });

    test('an error result with exit code 0 is still an error', async () => {
      process.env.FAKE_QWEN_MODE = 'error-exit0';
      await expect(handler.execute({ prompt: 'hello' })).rejects.toThrow(
        /reported an error: soft failure/
      );
    });

    test('a missing executable is a clear error', async () => {
      process.env.QWEN_MCP_BIN = path.join(fake.dir, 'not-there');
      await expect(handler.execute({ prompt: 'hello' })).rejects.toThrow(
        /could not start .*not-there.*ENOENT/
      );
    });
  });
});
