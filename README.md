<h1 align="center">qwen-mcp-server</h1>

<p align="center">
  <b>Give Claude Code, Codex, Cursor or any MCP client a Qwen Code teammate.</b><br>
  Ask it a question, hand it a task, and pick the conversation up again later. Read-only unless you say otherwise.
</p>

<p align="center">
  <a href="https://github.com/Theralley/qwen-mcp-server/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Theralley/qwen-mcp-server/ci.yml?branch=main&style=flat-square&label=CI"></a>
  <img alt="Tested with Qwen Code 0.28" src="https://img.shields.io/badge/tested%20with-Qwen%20Code%200.28-886FBF?style=flat-square">
  <img alt="Node 22 or newer" src="https://img.shields.io/badge/node-%E2%89%A522-339933?style=flat-square">
  <img alt="Model Context Protocol" src="https://img.shields.io/badge/MCP-stdio-1f6feb?style=flat-square">
  <a href="LICENSE"><img alt="ISC license" src="https://img.shields.io/badge/license-ISC-blue?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://www.buymeacoffee.com/theralley">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" height="48">
  </a>
</p>

[Qwen Code](https://github.com/QwenLM/qwen-code) is a coding agent for the terminal, and it has no
MCP-server mode. This server is the bridge: your agent calls the `qwen` tool, the server runs
Qwen Code headlessly in the folder you name, and the answer comes back as the tool result. A
second opinion from another model family, a reviewer that reads your branch itself, or a helper
that takes over a chore, from inside the agent you already use.

```sh
claude mcp add qwen -- npx -y github:Theralley/qwen-mcp-server
```

## What it does today

- **Ask and delegate.** One tool, `qwen`: a prompt in, Qwen Code's final answer out, with the
  model, turns, token use and time in the result's metadata.
- **Conversations that continue.** Give calls the same `sessionId` and Qwen remembers the earlier
  turns. Calls on one session queue up instead of trampling each other, and a session that
  cannot be resumed says so instead of quietly starting over.
- **Read-only by default.** In `plan` mode Qwen can read files and run read-only git (`git log`,
  `diff`, `show`, `status`, `blame`, `ls-files`), so it can review a branch itself, but it cannot
  edit anything. Raise the mode per call when you want it to work.
- **Your key stays out of sight.** An API key is read from a file at every call, passed to Qwen
  Code through its environment only, and scrubbed from everything the server returns.
- **Bounded runs.** Every call has a wall-time budget. A cancelled request, a timeout or a
  disconnected client stops Qwen Code and everything it started.

## What it does not do yet

- **No streaming.** The answer arrives when Qwen Code finishes. Clients that ask for progress get
  a heartbeat every 15 seconds.
- **A cold start per call.** Each call starts the Qwen Code CLI, which loads its settings and
  extensions again: a few seconds and some tokens of overhead.
- **Sessions are forgotten on restart.** The list of `sessionId`s lives in memory (up to 100, each
  for 24 hours). The conversations themselves stay in Qwen Code's own history.
- **Windows is untested.** The code has a Windows path, but it has never been run.
- **Not on npm yet.** It installs straight from GitHub, which takes a little longer the first time.

## Quick start

**1. Install Qwen Code and sign in once.** You need Node.js 22 or newer.

```sh
npm install -g @qwen-code/qwen-code
qwen          # sign in the way Qwen Code offers, then quit
```

If `qwen` answers a question in your terminal, the server can use it as it is. If you use an API
key from an OpenAI-compatible provider instead, see [Authentication](#authentication).

**2. Add the server to your client.** For Claude Code:

```sh
claude mcp add qwen -- npx -y github:Theralley/qwen-mcp-server
```

Other clients are under [Client setup](#client-setup).

**3. Try it.** Restart the client and ask:

> Use the qwen tool to review the last commit in this repository.

The first start downloads and builds the server, which can take a minute. If your client gives
up waiting, install it once with `npm install -g github:Theralley/qwen-mcp-server` and use the
command `qwen-mcp-server` instead of `npx -y github:Theralley/qwen-mcp-server`.

## Client setup

Every client starts the same command. Put `env` settings from
[Configuration](#configuration) where the examples show them, or leave them out.

<details>
<summary><b>Claude Code</b></summary>

```sh
claude mcp add qwen -- npx -y github:Theralley/qwen-mcp-server

# with an API key file:
claude mcp add qwen \
  -e QWEN_MCP_API_KEY_FILE=$HOME/.config/qwen/api.key \
  -e QWEN_MCP_BASE_URL=https://api.example.com/v1 \
  -e QWEN_MCP_DEFAULT_MODEL=your-model-id \
  -- npx -y github:Theralley/qwen-mcp-server
```

Check it with `/mcp` inside Claude Code.
</details>

<details>
<summary><b>Codex CLI</b> (<code>~/.codex/config.toml</code>)</summary>

```toml
[mcp_servers.qwen]
command = "npx"
args = ["-y", "github:Theralley/qwen-mcp-server"]

# optional
[mcp_servers.qwen.env]
QWEN_MCP_API_KEY_FILE = "/Users/you/.config/qwen/api.key"
QWEN_MCP_BASE_URL = "https://api.example.com/v1"
```
</details>

<details>
<summary><b>Cursor</b> (<code>~/.cursor/mcp.json</code>) and <b>Claude Desktop</b> (<code>claude_desktop_config.json</code>)</summary>

```json
{
  "mcpServers": {
    "qwen": {
      "command": "npx",
      "args": ["-y", "github:Theralley/qwen-mcp-server"],
      "env": {}
    }
  }
}
```

Claude Desktop starts servers with a minimal `PATH`. If it cannot find `npx` or `qwen`, use
absolute paths: `"command": "/usr/local/bin/npx"`, and `"QWEN_MCP_BIN": "/usr/local/bin/qwen"`
in `env`.
</details>

## Authentication

**Option A: Qwen Code's own sign-in.** Run `qwen` once and sign in. The server starts Qwen Code
with your normal settings, so nothing else is needed.

**Option B: an OpenAI-compatible endpoint with an API key.** Put the key in a file that only you
can read, and point the server at it:

```sh
mkdir -p ~/.config/qwen && printf '%s' 'YOUR-KEY' > ~/.config/qwen/api.key
chmod 600 ~/.config/qwen/api.key
```

Then set `QWEN_MCP_API_KEY_FILE`, `QWEN_MCP_BASE_URL` and usually `QWEN_MCP_DEFAULT_MODEL` in the
client's `env`. The file is read at every call, so a new key works without a restart.

## How safe is it?

| Approval mode | Qwen Code may | Use it for |
|---|---|---|
| `plan` (**default**) | read files, run read-only git | questions, reviews, plans |
| `default` | read files, plus only the tools you list in `allowedTools`: nothing else can be approved in a headless run | running your tests, say `run_shell_command(npm test)` |
| `auto-edit` | edit files | small, supervised changes |
| `auto` | what a classifier judges safe | trusted work |
| `yolo` | anything, including any shell command | a sandbox or a throwaway checkout |

- The default is `plan` unless the server's operator sets `QWEN_MCP_APPROVAL_MODE`. The tool
  description your client sees always names the default the server is really running with.
- `allowedTools` never changes the mode. In `plan` it may only list shell commands, and Qwen
  Code still refuses any it cannot classify as read-only. Other tools, such as `write_file`,
  need `default` or a higher mode.
- Qwen Code runs as your user, in the folder the call names.

More in [SECURITY.md](SECURITY.md).

## Tested and working

Tested on macOS with Qwen Code 0.28.7 and Node 26, through Claude Code.

| What | Result |
|---|---|
| Ask a question, get the answer and metadata | **Works** |
| Continue a conversation over several calls (`sessionId`) | **Works** |
| Plan mode reads the branch itself (`git log`, `git diff`) | **Works** |
| Plan mode refuses `git -C`, `gh` and anything not read-only | **Works**: refused by Qwen Code |
| API key from a file, scrubbed from errors | **Works** |
| Client disconnects or server is stopped mid-run: Qwen Code is killed | **Works** |
| Codex CLI, Cursor, Claude Desktop | Configuration shown above, not yet tested. Reports welcome. |
| Windows | Not tested |

The automated tests use a fake `qwen` and run in CI on Linux and macOS with Node 22 and 24.

## Latest news

- **27 November 2026, v0.2.0:** plan mode can no longer be widened into a writable mode, the tool
  description names the real default, Qwen Code is stopped when the client goes away, and the
  server runs straight from GitHub with `npx`. Details in [CHANGELOG.md](CHANGELOG.md).
- **23 November 2026, v0.1.0:** first version.

## Support the project

If it earns its place in your setup:

- [**Buy me a coffee**](https://www.buymeacoffee.com/theralley).
- **Star the repository**, so others find it.
- **Tell us what you run it with** in an [issue](https://github.com/Theralley/qwen-mcp-server/issues):
  client, operating system, Qwen Code version, and what worked.

---

## Reference

### Configuration

Environment variables on the server process. All are optional.

| Variable | Default | Meaning |
|---|---|---|
| `QWEN_MCP_BIN` | `qwen` | The Qwen Code executable. |
| `QWEN_MCP_API_KEY_FILE` | not set | File holding an API key, passed to Qwen Code as `OPENAI_API_KEY`. |
| `QWEN_MCP_API_KEY_ENV` | not set | More variable names that also receive the key, comma-separated. |
| `QWEN_MCP_BASE_URL` | not set | Passed to Qwen Code as `OPENAI_BASE_URL`. |
| `QWEN_MCP_AUTH_TYPE` | `openai` with a key file, else not passed | Value for Qwen Code's `--auth-type`. |
| `QWEN_MCP_DEFAULT_MODEL` | Qwen Code's default | Model used when a call names none. |
| `QWEN_MCP_APPROVAL_MODE` | `plan` | Approval mode used when a call names none. |
| `QWEN_MCP_MAX_WALL_TIME` | `15m` | Time budget per call: `90`, `30s`, `5m`, `1.5h`. |

Everything else in the server's environment is passed on to Qwen Code.

### Tools

**`qwen`** runs Qwen Code on a prompt and returns its final answer.

| Argument | Meaning |
|---|---|
| `prompt` (required) | The task or question. Sent on stdin, not on the command line. |
| `sessionId` | Your name for a conversation (letters, digits, `-`, `_`). The same name continues it. |
| `resetSession` | Start the conversation over. The old one is kept if the new run fails. |
| `workingDirectory` | Folder Qwen Code runs in. Fixed by a session's first call. |
| `approvalMode` | `plan`, `default`, `auto-edit`, `auto` or `yolo`. |
| `allowedTools` | Tools to allow without asking, for example `run_shell_command(npm test)`. Prefix matches. |
| `model` | Model for this call. |
| `maxWallTime` | Time budget for this call. |
| `appendSystemPrompt` | Extra instructions for the system prompt. |

The result's `_meta` holds `qwenSessionId`, `sessionId`, `resumed`, `workingDirectory`, `model`,
`approvalMode`, `durationMs`, `numTurns` and `usage`.

**`listSessions`** lists the known sessions with their Qwen session ID, folder, times and turn
count. **`ping`** answers `pong`. **`help`** returns `qwen --help`, or the version with
`command: "version"`.

<details>
<summary><b>How it works inside</b></summary>

- Each call runs `qwen --output-format json` with the prompt on stdin and parses the event list
  Qwen Code prints.
- A session's first call passes `--session-id <uuid>`, later calls `--resume <uuid>`. A Qwen
  session belongs to the folder it started in, so a later call with another `workingDirectory`
  is refused.
- Plan mode passes the read-only git commands as `--allowed-tools` prefixes and adds a line to
  the system prompt telling Qwen to run git from the working directory, because a prefix such as
  `git -C <dir> log` does not match.
- At the wall-time budget Qwen Code stops itself (exit code 55). If it has not exited 30 seconds
  later, the server kills it and everything it started. Output over 10 MB is reported as an
  error, not returned cut off.

</details>

## Development

```sh
git clone https://github.com/Theralley/qwen-mcp-server.git
cd qwen-mcp-server
npm install        # also builds dist/
npm test           # fake qwen, no network needed
npm run lint
```

`scripts/e2e.mjs` checks a real installation (it spends a few model calls): it calls `ping`, then
`qwen` twice on one session to prove resume works, with the `QWEN_MCP_*` variables of your shell.

```sh
npm run build && node scripts/e2e.mjs
```

The project structure started from [tuannvm/codex-mcp-server](https://github.com/tuannvm/codex-mcp-server),
which does the same for the OpenAI Codex CLI.

## License

ISC. See [LICENSE](LICENSE).
