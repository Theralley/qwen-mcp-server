# Security

## Reporting a vulnerability

Please report security problems privately through GitHub's
[private vulnerability reporting](https://github.com/Theralley/qwen-mcp-server/security/advisories/new),
not in a public issue. You will get an answer within a week.

## What this server does with your secrets

- An API key is read from the file in `QWEN_MCP_API_KEY_FILE` at every call and handed to
  Qwen Code through its environment only. It is never put on a command line, written to
  disk or logged.
- That key, and any key the server inherited in `OPENAI_API_KEY`, `DASHSCOPE_API_KEY` or
  the names in `QWEN_MCP_API_KEY_ENV`, is replaced with `[REDACTED]` in every answer and
  error the server returns.
- The prompt goes to Qwen Code on stdin, not on the command line, so other users of the
  machine cannot read it from the process list.

## What the approval modes mean for safety

The server's default is `plan`: Qwen Code reads and analyzes but cannot edit files, and the
only shell commands it may run are read-only git commands. In `plan`, a caller's
`allowedTools` may only add shell commands, which plan mode still checks. Qwen Code itself also refuses,
in plan mode, any command it cannot classify as read-only.

An operator can change the default with `QWEN_MCP_APPROVAL_MODE`, and a caller can pass
`approvalMode` per call. `auto-edit`, `auto` and `yolo` let Qwen Code change files, and
`yolo` lets it run any command. The tool description an MCP client sees always names the
default the server is actually running with.

Qwen Code runs as your user, with your permissions, in the working directory the caller
names. Treat a raised approval mode like giving a colleague your keyboard.
