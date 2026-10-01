# Isolated Codex MCP compatibility experiment

See [the evidence and repeatable procedure](../../docs/research/codex-compatibility-probe.md).

This package uses Bun and the official MCP TypeScript SDK v2 web-standard handler. It serves a tiny temporary answer page; it is deliberately outside the production Bun workspaces. Its in-memory state lasts across MCP requests/client reconnects, not server process restarts.

Install with `bun install --frozen-lockfile`, run the focused modern-protocol checks with `bun run test`, and run `bun run typecheck`. Use `bun live.ts strict|wait|continue|timeout` with a stable Chrome executable in `SLOP_CHROME_PATH` for live Codex/browser evidence. The helper needs an authenticated Codex CLI. The CLI's server configuration is temporary and does not modify user configuration.
