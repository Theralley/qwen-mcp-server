import { readFileSync } from 'node:fs';
import { ConfigError } from './errors.js';
import {
  APPROVAL_MODES,
  DURATION_PATTERN,
  type ApprovalModeName,
} from './types.js';

type Env = Record<string, string | undefined>;

export interface QwenConfig {
  bin: string;
  apiKeyFile?: string;
  /** Extra environment variable names that also receive the key. */
  apiKeyEnv: string[];
  baseUrl?: string;
  authType?: string;
  defaultModel?: string;
  approvalMode: ApprovalModeName;
  maxWallTime: string;
}

export const DEFAULT_APPROVAL_MODE: ApprovalModeName = 'plan';
export const DEFAULT_MAX_WALL_TIME = '15m';

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const value = (env: Env, name: string): string | undefined =>
  env[name]?.trim() || undefined;

/** Read the server configuration from QWEN_MCP_* environment variables. */
export function loadConfig(env: Env = process.env): QwenConfig {
  const apiKeyFile = value(env, 'QWEN_MCP_API_KEY_FILE');

  const apiKeyEnv = (value(env, 'QWEN_MCP_API_KEY_ENV') ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const badName = apiKeyEnv.find((name) => !ENV_NAME_PATTERN.test(name));
  if (badName) {
    throw new ConfigError(
      `QWEN_MCP_API_KEY_ENV contains an invalid variable name: "${badName}"`
    );
  }

  const approvalMode =
    value(env, 'QWEN_MCP_APPROVAL_MODE') ?? DEFAULT_APPROVAL_MODE;
  if (!(APPROVAL_MODES as readonly string[]).includes(approvalMode)) {
    throw new ConfigError(
      `QWEN_MCP_APPROVAL_MODE must be one of ${APPROVAL_MODES.join(', ')}`
    );
  }

  const maxWallTime =
    value(env, 'QWEN_MCP_MAX_WALL_TIME') ?? DEFAULT_MAX_WALL_TIME;
  if (!DURATION_PATTERN.test(maxWallTime)) {
    throw new ConfigError(
      'QWEN_MCP_MAX_WALL_TIME must look like 90, 30s, 5m or 1.5h'
    );
  }

  return {
    bin: value(env, 'QWEN_MCP_BIN') ?? 'qwen',
    apiKeyFile,
    apiKeyEnv,
    baseUrl: value(env, 'QWEN_MCP_BASE_URL'),
    // With a key file the OpenAI-compatible route is the sensible default;
    // without one Qwen Code's own settings decide.
    authType:
      value(env, 'QWEN_MCP_AUTH_TYPE') ?? (apiKeyFile ? 'openai' : undefined),
    defaultModel: value(env, 'QWEN_MCP_DEFAULT_MODEL'),
    approvalMode: approvalMode as ApprovalModeName,
    maxWallTime,
  };
}

/**
 * Read the API key. Called for every Qwen run so a rotated key is picked up
 * without a restart. The value is only ever handed to the child's environment.
 */
export function readApiKey(config: QwenConfig): string | undefined {
  if (!config.apiKeyFile) return undefined;
  let key: string;
  try {
    key = readFileSync(config.apiKeyFile, 'utf8').trim();
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'unknown error';
    throw new ConfigError(
      `cannot read QWEN_MCP_API_KEY_FILE (${config.apiKeyFile}): ${code}`
    );
  }
  if (!key) {
    throw new ConfigError(
      `QWEN_MCP_API_KEY_FILE (${config.apiKeyFile}) is empty`
    );
  }
  return key;
}

/** Environment overrides for the Qwen child process. */
export function buildChildEnv(
  config: QwenConfig,
  apiKey: string | undefined
): Record<string, string> {
  const env: Record<string, string> = {};
  if (apiKey) {
    env.OPENAI_API_KEY = apiKey;
    for (const name of config.apiKeyEnv) env[name] = apiKey;
  }
  if (config.baseUrl) env.OPENAI_BASE_URL = config.baseUrl;
  return env;
}

/** Convert a Qwen duration (`90`, `30s`, `5m`, `1.5h`) to milliseconds. */
export function durationToMs(duration: string): number {
  const match = DURATION_PATTERN.exec(duration);
  if (!match) throw new ConfigError(`invalid duration: "${duration}"`);
  const factor = { s: 1000, m: 60_000, h: 3_600_000 }[match[2] ?? 's'] ?? 1000;
  return Math.round(Number(match[1]) * factor);
}
