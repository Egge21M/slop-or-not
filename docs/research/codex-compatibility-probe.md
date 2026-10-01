# Codex browser Response compatibility probe

Tested on 2026-10-01 for [ticket #2](https://github.com/Egge21M/slop-or-not/issues/2), using the isolated `experiments/codex-probe` package. This is a local compatibility experiment, not the production frontend or persistence implementation.

## Observed versions and revision mismatch

| Component | Observed |
| --- | --- |
| Bun | 1.3.14 |
| Official `@modelcontextprotocol/server` | 2.2.0 |
| Official `@modelcontextprotocol/client` (focused checks) | 2.2.0 |
| Codex CLI | 0.159.2, authenticated using ChatGPT |
| Browser | Google Chrome for Testing stable 154.0.8037.92, phone viewport 390×844 |
| Browser driver | Playwright 1.56.1 under Bun |
| Target official MCP revision | 2026-07-28 |
| Actual Codex offered/negotiated MCP revision | 2025-06-18 |

The strict latest-revision endpoint (`legacy: 'reject'`) returned HTTP 400 to Codex's `initialize`. Codex initialized with 2025-06-18, then sent that revision in subsequent `MCP-Protocol-Version` headers when the SDK's explicitly enabled stateless compatibility path was tested. SDK v2 alone does not mean this installed Codex speaks the latest protocol. The modern pinned SDK client does pass the same server's 2026-07-28 round trip through public MCP interfaces. [SDK protocol migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28)

The real Codex `initialize` capabilities were exactly `{"elicitation":{"form":{},"url":{}}}`. It did not declare Tasks or modern subscriptions. Native Tasks plus subscription SSE completion delivery was investigated first at this negotiation boundary and is unavailable in this tested client configuration. Advertising support the client did not declare would not establish interoperability. Consequently no Tasks extension, custom Codex host, or draft Events dependency was added. The following ordinary-tool fallback was then tested explicitly.

## Live results

The checked-in [evidence directory](codex-probe-evidence/) contains sanitized server observations and real CLI JSONL output, plus browser observations; credentials and unrelated client metadata are excluded.

- [Strict latest probe](codex-probe-evidence/strict.json): two 2025-06-18 initialization attempts, each rejected with HTTP 400; the model could not access the tool. Its final prose did not expose the startup error, so server-side observations establish the mismatch.
- [Waiting](codex-probe-evidence/wait.json): Codex submitted `probe-wait`, received `pending`, called `wait_for_response`, and consumed `answered` / `yes` after the separate Chrome page clicked Yes. Tool responses were `text/event-stream`.
- [Independent work](codex-probe-evidence/continue.json): after submission returned `pending`, Codex produced `17 × 19 = 323` with arithmetic before consuming the separate browser's `yes`. No blocked tool call was needed while doing that work.
- [Timeout and reconnect](codex-probe-evidence/timeout.json): Codex requested a 20-second wait with its tool timeout reduced to one second. It reported `timed out awaiting tools/call after 1000ms`. At 1.5 seconds after wait start the browser fetched the Question and observed `pending`. The browser subsequently supplied `yes`. A fresh Codex process initialized separately and retrieved the same Question as `answered` / `yes`. Loss of a wait did not answer or cancel it. The legacy server's abort observation arrived later than the client deadline; finite application waits remain necessary even when transport cancellation is delayed.

MCP SSE here carries the result for the active tool call. It does not wake an idle Codex run. The model chose its next tool call while its turn was active; the reconnect run was explicitly launched by the experiment. No automatic interruption, idle resumption, or notification-driven scheduling was demonstrated or promised.

## Implementation-facing contract

Use the official SDK v2 web-standard `createMcpHandler(factory, { legacy: 'stateless' })` endpoint behind bearer authentication. It serves the modern revision while explicitly retaining compatibility for the observed Codex client. Log the negotiated revision in controlled diagnostics without dumping credentials or client metadata. Do not silently describe this Codex round trip as a latest-revision round trip.

Register ordinary `submit_question`, `get_response`, and `wait_for_response` tools. Submission returns the authoritative current state immediately; repeat identical submissions retrieve it and conflicts fail. Retrieval is independent of the submitting SDK instance. A bounded wait returns an outcome when available or `pending` at its deadline. Timeout, abort, or disconnect only end local waiting. Reconnect uses the originally chosen Question ID to read current state. Expose get/wait as read-only tools. Agents decide whether to wait or continue independent work, then explicitly retrieve or wait again.

The experiment caps `waitMs` at 20,000 and configures ordinary Codex tool calls to 30 seconds, keeping the application bound below the client timeout. Production must preserve that relationship and clean up waits when abort signals arrive. Keep application state outside the factory because the web-standard handler creates per-request server instances. Production replaces the experiment's single-token Map with Inbox-scoped durable SQLite state, JWT validation, UUIDv7 identifiers, project/session metadata, expiry markers, and lifecycle transitions in their assigned tickets.

Authentication was real bearer authentication: `bearer_token_env_var = "SLOP_PROBE_TOKEN"` on Codex, and `Authorization: Bearer …` from the page. The probe's generated random bearer token is temporary and held only in process/page memory. It is not a production JWT implementation. No token appears in URLs or evidence. Missing credentials are rejected. [Official OpenAI MCP configuration](https://learn.chatgpt.com/docs/extend/mcp)

Codex noninteractive runs initially rejected the write tool because their approval policy was `never`. The repeatable harness grants `approval_mode = "approve"` only to the isolated probe's `submit_question` tool, through invocation arguments; it does not change saved user permissions. The get/wait tool annotations mark them read-only. [Official OpenAI configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)

## Repeatable procedure

The package has its own dependency lock and does not participate in production workspaces. From the repository root:

```sh
cd experiments/codex-probe
bun install --frozen-lockfile
bun run test
bun run typecheck
codex --version
codex login status
```

Select a current stable Chrome executable and set its path. The tested executable was downloaded from the official [Chrome for Testing stable release manifest](https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json); the local path was `/tmp/slop-chrome-stable/chrome-linux64/chrome`. Playwright's bundled Chromium was older and was not used as the stable-Chrome evidence.

```sh
export SLOP_CHROME_PATH=/absolute/path/to/stable/chrome
bun live.ts strict
bun live.ts wait
bun live.ts continue
bun live.ts timeout
```

`live.ts` starts a loopback Bun server on an ephemeral port, opens the separate Chrome answer page, creates a temporary credential, and invokes real `codex exec` with one configured MCP endpoint. Waiting/timeout modes delay the browser answer until the server observes an active wait. Continue mode lets the model finish its independent arithmetic first. Timeout mode launches a second Codex process against the same application state. Results go to `/tmp/slop-probe-evidence`, overridable with `SLOP_PROBE_EVIDENCE`; passing model prose alone is insufficient, so inspect completed tool results and browser observations. The harness exits nonzero when expected observations are missing.

The focused Bun checks use a pinned modern SDK client against the public MCP/HTTP browser boundaries and verify independent-request retrieval, a bounded pending return, and client timeout followed by retrieval of a still-pending Question. They are invoked separately from production tests as `bun run test` in this package.

For a manual page experiment, set `SLOP_PROBE_TOKEN` to a temporary credential, run `SLOP_PROBE_LEGACY=1 bun server.ts`, visit `http://127.0.0.1:4317`, enter the credential, and click Connect. Configure Codex's URL to `http://127.0.0.1:4317/mcp` and its bearer environment variable to the same token. Keep the credential in the environment/page field rather than a URL or command transcript. The server's default is strict modern mode; compatibility requires explicit opt-in.

This cloud executor required elevated execution for browser crashpad sockets and the authenticated Codex process. No managed environment status tool or network-policy snapshot was available in this executor. The experiment used the configured CLI authentication normally without inspecting secret contents. This local probe does not verify a hosted Fly proxy or production server restart; those checks belong to the hosted release smoke test.
