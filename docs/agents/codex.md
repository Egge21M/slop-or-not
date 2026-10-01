# Ask a human through Slop or Not

Create an Inbox on the phone, save its shared credential, and copy the MCP endpoint. The phone and all agents use that same bearer JWT. Anyone holding it can read, submit, and answer Questions; it is a trusted private-pilot credential. Keep it out of URLs, source files, and logs. Save a separate copy because there is no credential recovery.

Set `SLOP_OR_NOT_TOKEN` in the environment that launches Codex, using the phone's credential. Add this server configuration to Codex, replacing the endpoint with the paired app's HTTPS URL:

```toml
[mcp_servers.slop_or_not]
url = "https://YOUR_APP_HOST/mcp"
bearer_token_env_var = "SLOP_OR_NOT_TOKEN"
tool_timeout_sec = 30
```

Use the client's normal approval controls for the write tool `submit_question`. Retrieval and waits are annotated read-only. The repeatable smoke helper uses a temporary invocation setting to authorize only its test submission; it does not change saved user permissions.

Choose a UUIDv7 Question ID **before** submitting, and retain it with the exact original content. For Bun scripts, `Bun.randomUUIDv7()` generates one. Each submission supplies `questionId`, `wording`, `project`, `agentSession`, and optional `supportingMarkdown`. Ask a concrete yes/no Question such as “Should I apply the database migration before restarting the app?” Explain relevant tradeoffs or short code snippets in supporting Markdown. The human may instead send a free-text Custom answer, so consume the Response type and value rather than assuming every delivered answer is binary.

An identical `submit_question` retry returns the current state without another card. Reusing the ID with different content is a conflict. Questions are immutable; changing the request requires explicit cancellation and a new ID. A pending Question has no delivered Response. A provisional binary choice during its Undo window also has no delivered Response.

Choose the interaction mode based on the work:

- **Wait for input:** submit, then call `wait_for_response` with the same `questionId`. `waitMs` defaults to 10,000 and accepts integers from 0 through 20,000. A committed outcome returns when available. At the bound the tool returns the authoritative current state; `pending` means no final answer yet. Reissue a wait when human input remains necessary. Keep the 30-second client timeout above the 20-second application bound.
- **Continue independent work:** submit and receive control immediately. Do work that does not depend on the answer, then call `get_response` or a bounded wait with the original ID. Do not infer approval merely because the human has not responded.

Timeout, abort, request cancellation, or disconnection ends local observation only. It never answers or cancels the Question. After reconnect or a server restart, use the shared credential and original ID to retrieve the authoritative state. Submission and observation retries do not create duplicate cards. Follow the final Response once answered; respect cancellation or expiry outcomes rather than acting on missing text. If the Inbox is unavailable, its credential no longer grants access; do not recreate old Questions in another Inbox automatically.

The tested Codex CLI 0.159.2 negotiated MCP **2025-06-18**, while official SDK v2.2.0 also serves the target **2026-07-28** revision. The server explicitly enables stateless compatibility. This Codex did not advertise native Tasks or modern subscriptions, so the app uses ordinary submit/retrieve/bounded-wait tools. MCP SSE delivers the result of an active call; it does not automatically interrupt or resume an idle Codex run. Retrieval and further waits require an active agent turn. See [the actual compatibility evidence](../research/codex-compatibility-probe.md) and [production wait checks](../research/codex-production-wait.md).
