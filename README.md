# Slop or Not

Coding agents ask immutable yes/no Questions through MCP. A phone browser pairs an Inbox, receives foreground updates, and answers with right/left/up swipes or Yes/No/Custom controls. Binary choices have a persisted three-second Undo window; Custom answers commit on Send. Priority queues, manual pending selection, bounded agent waits, retained history, and Inbox deletion are included.

The agreed scope lives in [issue #1](https://github.com/Egge21M/slop-or-not/issues/1), [technical scope](docs/technical-scope.md), [GLOSSARY.md](GLOSSARY.md), and [ADRs](docs/adr/). Read the [Codex compatibility evidence](docs/research/codex-compatibility-probe.md) before assuming native Tasks or automatic agent resumption.

Use Bun 1.3.14. Dependencies are locked in `bun.lock`:

```sh
bun install --frozen-lockfile
bun run check
```

- `apps/web`: React 19.3.0, TypeScript, Vite 8.3.1, and the official shadcn Vite starter (shadcn 4.21.0, nova preset, Base UI).
- `apps/server`: Bun HTTP/static server, authenticated phone SSE, official MCP SDK v2 2.2.0, jose, and Drizzle over `bun:sqlite`.
- `packages/shared`: browser-safe Zod schemas and domain types.
- `experiments/codex-probe`: isolated compatibility experiment with its own lock and checks; root production scripts do not execute it.

## Local development

Create a root `.env` with a stable random signing secret of at least 32 bytes. For example, generate it locally with `bun -e 'console.log(crypto.randomUUID() + crypto.randomUUID())'` and save the result as `JWT_SECRET`. Never commit it or use a `VITE_` variable for it.

```dotenv
JWT_SECRET=replace-with-your-own-stable-random-secret
DATABASE_PATH=./data/slop.sqlite
PORT=3000
```

```sh
bun run dev
```

Visit the Vite URL, normally `http://localhost:5173`. Its `/api`, `/mcp`, and `/health` proxy forwards to Bun on port 3000 and rewrites browser Origin to the backend origin. Leave `PUBLIC_ORIGIN` unset for this proxy workflow. `DATABASE_PATH` is resolved from the server workspace when using its start/dev script.

## Production build and startup

```sh
bun run build
# Supply the stable JWT_SECRET in the environment, and use persistent storage:
NODE_ENV=production PUBLIC_ORIGIN=https://YOUR_PRIVATE_HOST \
  DATABASE_PATH=/data/slop.sqlite PORT=8080 \
  bun apps/server/dist/index.js
```

Bun serves the Vite output, API, phone SSE, and `/mcp` from one origin. Preserve `apps/server/migrations` beside the source/dist directories: checked-in SQL migrations apply synchronously before traffic, and migration failure stops startup. Production startup requires an absolute `DATABASE_PATH` and a valid HTTPS `PUBLIC_ORIGIN`; use mounted persistent storage and keep `JWT_SECRET` stable across restarts. Backend HTTP behind TLS termination is supported. `/health` is a public GET endpoint for internal probes. `HOST` defaults to `0.0.0.0` and `PORT` to 3000 (8080 in the container/Fly config).

The Bun entrypoint disables idle timeouts for phone SSE and MCP requests. Phone SSE emits 15-second heartbeats, uses bearer-authenticated fetch, and refreshes authoritative Inbox state on reconnect. No event replay or background notification is promised. Keep the SQLite database, WAL, and SHM files out of source control.

To generate a migration after a schema change, run `bunx --bun drizzle-kit generate` from `apps/server`; review and commit its SQL and metadata. Do not modify an already deployed migration.

## Phone pairing and agent setup

Open the phone page and choose **Create Inbox**. The app saves the JWT in localStorage. Expand **Pair agents & save credential** to copy the shared credential and MCP endpoint. Save another copy: there is no registration, credential recovery, or automatic token expiry. Another browser joins by pasting the same credential.

Credential holders can ask, read, and answer Questions. Inbox existence is required in addition to a valid JWT, and every lookup is scoped to that Inbox. Credentials are sent only in bearer headers and are never added to URLs or application logs.

For Codex, put the shared credential in an environment variable on your machine and configure its endpoint:

```toml
[mcp_servers.slop_or_not]
url = "https://your-host/mcp"
bearer_token_env_var = "SLOP_INBOX_TOKEN"
tool_timeout_sec = 30
```

`submit_question` takes `questionId` (an agent-chosen UUIDv7), `wording`, `project`, `agentSession`, and optional `supportingMarkdown`. Phrase wording as a yes/no Question. It returns immediately; retain the chosen ID and use `get_response` after independent work or reconnecting. An identical retry returns the current outcome; any changed original content conflicts. A submitted Question is never tied to an MCP request's lifetime.

The MCP handler explicitly enables the stateless legacy path for tested Codex 0.159.2 (2025-06-18) while also serving the modern 2026-07-28 revision. `wait_for_response` waits up to 20 seconds; timeout/disconnection leaves the Question pending. Native Tasks and idle automatic resumption were not demonstrated. See [agent instructions](docs/agents/codex.md) for wait/continue, cancellation, retries, and reconnect behavior.

The pilot is intended for an unlisted testing URL; anyone who discovers it can create an Inbox. Credential holders are trusted to submit, read, answer, and delete. Finished content expires after seven days; Inbox deletion revokes every paired device and agent. There is no credential recovery, backup, or background notification.

The [tester guide](docs/pilot-tester.md) covers pairing, saving/pasting access, all Response controls, navigation, and deletion. The [operator guide](docs/pilot-operator.md) describes the Docker package, one always-running Fly Machine, one persistent volume, stable secrets, disabled snapshots, and restart. [Release evidence](docs/research/release-smoke.md) records local Chrome/Codex checks and outstanding Docker/hosted HTTPS gates. Actual paid provisioning/deployment is separate from producing this package.
