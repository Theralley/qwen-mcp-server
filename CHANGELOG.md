# Changelog

## 0.2.0 (2026-11-27)

**Safer plan mode**
- `plan` now always stays `plan`. Before, a `plan` call with `allowedTools` ran in `default`
  mode, where the read-only git prefixes were no longer checked, so `git branch -D` or
  `git log --output=FILE` could write. To run other commands without edits, ask for
  `approvalMode: "default"` with `allowedTools`.
- In `plan`, `allowedTools` may only list shell commands. Qwen Code 0.28 runs an allowed
  tool such as `write_file` before its plan-mode check, so such a call is now refused.
- Plan mode lets Qwen read the repository with `git log`, `show`, `diff`, `status`, `blame`
  and `ls-files`, and tells it not to use `git -C`.
- `gh` and `git branch` are no longer on the plan-mode list (`gh` is refused by Qwen Code's
  read-only check anyway, and `git branch` can create and delete branches).

**Honest tool description**
- The `qwen` tool description names the default approval mode the server really runs
  with, so a server set to `yolo` no longer tells the client it is read-only.

**Robustness**
- When the client disconnects, or the server gets SIGTERM, SIGINT or SIGHUP, running Qwen
  processes are killed instead of left behind.
- A cancelled or timed-out run, or one whose output passed 10 MB, is reported as an error
  even if Qwen exits with code 0.
- A key the server inherited (`OPENAI_API_KEY` and others) is scrubbed from output too, as
  are the result metadata and the `help` tool's output.
- On cancel or timeout, helpers Qwen started that ignore SIGTERM are killed as well.
- `resetSession` keeps the old conversation if the new run fails.

**Packaging**
- Node 22 or newer (Qwen Code 0.28 needs it).
- Runs straight from GitHub: `npx -y github:Theralley/qwen-mcp-server`.
- CI, `SECURITY.md` and this changelog.

## 0.1.0 (2026-11-23)

First version: the `qwen`, `listSessions`, `ping` and `help` tools, multi-turn sessions,
API key file, wall-time budget.
