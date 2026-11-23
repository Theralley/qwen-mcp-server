# qwen-mcp-server

An MCP server that lets an MCP client such as Claude Code talk to the
[Qwen Code](https://github.com/QwenLM/qwen-code) CLI: ask it a question, hand
it a task, and continue the same conversation over several calls.

Qwen Code has no MCP-server mode of its own, so this server starts the `qwen`
CLI once per call in headless mode (`--output-format json`) and returns the
final answer.

The project structure and parts of the code come from
[tuannvm/codex-mcp-server](https://github.com/tuannvm/codex-mcp-server), which
does the same for the OpenAI Codex CLI.

## Requirements

- Node.js 20 or newer
- Qwen Code installed and on `PATH` (developed against 0.28.0), or its path in
  `QWEN_MCP_BIN`
- Working Qwen Code authentication: either Qwen Code's own settings, or an API
  key file configured below

## Install

```sh
git clone <this repository> qwen-mcp-server
cd qwen-mcp-server
npm install        # also builds dist/
```

Register it with your MCP client. For Claude Code:

```sh
claude mcp add qwen \
  -e QWEN_MCP_API_KEY_FILE=/path/to/api.key \
  -e QWEN_MCP_BASE_URL=https://api.example.com/v1 \
  -e QWEN_MCP_DEFAULT_MODEL=your-model-id \
  -- node /path/to/qwen-mcp-server/dist/index.js
```

or as JSON:

```json
{
  "mcpServers": {
    "qwen": {
      "command": "node",
      "args": ["/path/to/qwen-mcp-server/dist/index.js"],
      "env": {
        "QWEN_MCP_API_KEY_FILE": "/path/to/api.key",
        "QWEN_MCP_BASE_URL": "https://api.example.com/v1",
        "QWEN_MCP_DEFAULT_MODEL": "your-model-id"
      }
    }
  }
}
```

If `qwen` already works when you run it yourself without extra flags, you need
no `env` at all.

## Configuration

Everything is set through environment variables on the server process. All are
optional.

| Variable | Default | Meaning |
|---|---|---|
| `QWEN_MCP_BIN` | `qwen` | The Qwen Code executable. |
| `QWEN_MCP_API_KEY_FILE` | not set | File holding an API key. Its content is passed to Qwen Code as `OPENAI_API_KEY`. |
| `QWEN_MCP_API_KEY_ENV` | not set | Further environment variable names that also receive the key, comma-separated (for example `MY_PROVIDER_API_KEY`). |
| `QWEN_MCP_BASE_URL` | not set | Passed to Qwen Code as `OPENAI_BASE_URL`. |
| `QWEN_MCP_AUTH_TYPE` | `openai` when a key file is set, otherwise not passed | Value for `--auth-type`. When it is not passed, Qwen Code's own settings decide. |
| `QWEN_MCP_DEFAULT_MODEL` | not set | Model used when a call names none. Without it Qwen Code's own default applies. |
| `QWEN_MCP_APPROVAL_MODE` | `plan` | Approval mode used when a call names none. `plan` is read-only. |
| `QWEN_MCP_MAX_WALL_TIME` | `15m` | Time budget per call when a call names none: seconds (`90`) or `30s`, `5m`, `1.5h`. |

The key file is read at every call, so a rotated key works without a restart.
The key is given to Qwen Code through its environment only: it is never put on
a command line, never written to disk and never logged, and it is removed from
any output or error text the server returns. Keep the file readable by you
alone (`chmod 600`).

Apart from these variables, Qwen Code inherits the server's environment.

## Tools

### `qwen`

Runs Qwen Code on a prompt and returns its final answer.

| Argument | Meaning |
|---|---|
| `prompt` (required) | The task or question. Sent on stdin, so its length and content are not limited by the command line. |
| `sessionId` | Your own name for a conversation (letters, digits, `-`, `_`). Calls with the same name continue the same Qwen session. |
| `resetSession` | Forget the Qwen session behind `sessionId` and start a new one. |
| `model` | Model for this call. |
| `approvalMode` | `plan`, `default`, `auto-edit`, `auto` or `yolo`. |
| `workingDirectory` | Directory Qwen Code runs in. Defaults to the server's own. |
| `maxWallTime` | Time budget for this call. |
| `appendSystemPrompt` | Extra instructions appended to the system prompt. |

The result's `_meta` carries `qwenSessionId`, `sessionId`, `resumed`,
`workingDirectory`, `model`, `approvalMode`, `durationMs`, `numTurns` and
`usage`.

**Approval modes.** `plan` lets Qwen Code read and analyze but not edit files
or run commands. `auto-edit` approves file edits, `auto` lets a classifier
approve safe actions, and `yolo` approves everything. `default` asks for
approval, and a headless run has nobody to give it. Raise the mode only for
work where Qwen Code should change things.

**Sessions.** The first call with a new `sessionId` creates a Qwen session
(`--session-id <uuid>`); later calls continue it (`--resume <uuid>`). A Qwen
session belongs to the directory it was started in, so the session keeps the
working directory of its first call, and a different `workingDirectory` on a
later call is rejected. If Qwen Code cannot resume the session, the call fails
and says so. It does not quietly start a new conversation; pass
`resetSession: true` to do that. Calls on one `sessionId` run one after
another.

The mapping from `sessionId` to Qwen session lives in the server's memory: up
to 100 sessions, each dropped 24 hours after its last use, and all of them
when the server restarts. The Qwen sessions themselves stay in Qwen Code's own
history.

**Time limit.** Qwen Code stops itself at the wall-time budget (exit code 55,
reported as an exceeded budget). If it has not exited 30 seconds after that,
the server kills it and the processes it started. A cancelled MCP request
stops the run as well.

### `listSessions`

Lists the sessions the server knows: `sessionId`, `qwenSessionId`,
`workingDirectory`, creation and last-use time, and the number of turns.

### `ping`

Returns `pong`, or the `message` you pass.

### `help`

Returns `qwen --help`, or the installed version with `command: "version"`.

## Development

```sh
npm run build     # compile to dist/
npm test          # builds, then runs the jest suite
npm run lint
```

The tests use a fake `qwen` executable and need neither Qwen Code nor a
network connection.

`scripts/e2e.mjs` checks a real installation: it calls `ping`, then `qwen`
twice on one session to prove that resume works. It uses the `QWEN_MCP_*`
variables of the shell it is started from and spends a few model calls:

```sh
npm run build
QWEN_MCP_API_KEY_FILE=/path/to/api.key \
QWEN_MCP_BASE_URL=https://api.example.com/v1 \
QWEN_MCP_DEFAULT_MODEL=your-model-id \
node scripts/e2e.mjs
```

## Limits

- One CLI process per call. Qwen Code loads its settings, context files,
  extensions and MCP servers each time, which costs a few seconds and some
  tokens per call.
- No streaming: the answer arrives when the run ends. Clients that send a
  progress token get a progress notification every 15 seconds.
- Developed and tested on macOS. The Windows code path is carried over from
  codex-mcp-server and has not been run.

## License

ISC. See [LICENSE](LICENSE).
