# Production MCP waiting and reconnect checks

Verified locally on 2026-10-01 for [ticket #6](https://github.com/Egge21M/slop-or-not/issues/6). These checks use the production application, its migrated Drizzle/bun:sqlite database and JWT authentication, the Vite-built phone UI, and real Codex. They extend [the protocol compatibility experiment](codex-compatibility-probe.md).

## Versions and observations

Bun 1.3.14, official MCP server/client SDK 2.2.0, Codex CLI 0.159.2, Chrome for Testing stable 154.0.8037.92, and Playwright Core 1.56.1. The Chrome viewport was 390×844. The production SDK handler explicitly enables stateless compatibility: real Codex again offered and used **2025-06-18**, while the focused SDK integration checks pin the target **2026-07-28** revision. This remains an explicit client/spec mismatch, not a claim of latest-revision Codex support.

The checked-in [sanitized evidence](codex-production-evidence/) records client results, protocol/tool observations, and assertions; JWTs are not recorded.

- **Waiting:** the phone created an Inbox, Codex submitted its chosen UUIDv7 Question ID, and the submission returned `pending`. Codex held `wait_for_response`; after observing the active wait, the separate Chrome page clicked Yes. Codex consumed the authoritative `answered` binary yes result.
- **Continuing:** submission returned `pending`, Codex wrote its independent arithmetic explanation (`17 × 19 = 323`) before its next tool call, then consumed the separately supplied phone Response through a bounded wait. The evidence verifies ordering in completed client events.
- **Timeout/reconnect:** Codex asked for a 20-second wait with a deliberately reduced one-second client timeout. The phone's authenticated lookup at 1.5 seconds still observed `pending`; it then clicked Yes. The application was closed and recreated against the same SQLite file and signing secret. A new Codex process retrieved the committed yes outcome twice using the original Question ID and JWT.
- The first timeout run's reconnect model declined to call `get_response`, describing the tool as unavailable. The trace contains initialization and tool listing but no retrieval, so that attempt fails the smoke assertion and is retained separately. A repeated run made both retrieval calls and passed. Model prose alone is not counted as delivery evidence.

Waiting and continuing were first exercised against the foundation's immediate binary contract. Timeout/reconnect was also rerun after integration of the persisted three-second Undo window. Final pilot feature coverage, Custom answers, swipes, cancellation/deletion, and hosted transport checks belong to the release smoke in ticket #11.

## Focused public-boundary checks

`bun test apps/server/tests/wait.test.ts` uses real MCP requests and authenticated HTTP phone requests, including distinct SDK instances, to verify delayed commitment; pending at a bounded deadline; client timeout and explicit abort without an answer or cancellation; identical submission retries producing one pending card; original-credential retrieval of pending and committed state across application restarts; repeated final retrieval; invalid bounds; and store closure releasing an active wait. After the binary lifecycle merge, it also verifies that submit/get/wait never expose provisional choice IDs or values while the Question remains pending. The three-second deadline is exercised with actual timers; no private database query is used.

The full `bun run check` passed with 20 integration tests, strict workspace typechecks, Vite frontend build, and Bun server build after integrating the binary lifecycle.

Waits read the authoritative store initially, after subscribing, on committed Inbox changes, and at the bound. The second read closes the lookup/subscription gap. Timers and listeners are cleared on completion, error, cancellation, and store closure. Deleted-Inbox change publication causes the next authoritative lookup to fail unavailable; the deletion ticket tests that transition. Waiting never holds a synchronous SQLite transaction.

## Repeat the real smoke

Use an authenticated Codex CLI, a separately installed Playwright Core module, and the current stable Chrome executable. These are smoke prerequisites rather than production dependencies. From the repository root:

```sh
bun install --frozen-lockfile
bun run build
export SLOP_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs
export SLOP_CHROME_PATH=/absolute/path/to/stable/chrome
bun apps/server/scripts/codex-smoke.ts wait
bun apps/server/scripts/codex-smoke.ts continue
bun apps/server/scripts/codex-smoke.ts timeout
```

The helper creates a temporary SQLite database, starts production HTTP/MCP on loopback, pairs a real Chrome phone page, configures ephemeral `codex exec` processes, and delays phone input until a wait is observed. It authorizes only the test `submit_question` through an invocation argument; it does not edit saved Codex permissions. Evidence defaults to `/tmp/slop-production-codex-evidence` and can be redirected with `SLOP_SMOKE_EVIDENCE`. The helper exits nonzero when the recorded tool behavior does not meet its assertions. This executor required elevated execution for Chrome sockets and the authenticated Codex process.

The restart here recreates the production application/SDK/database owners inside the loopback harness; it is not a Fly Machine restart. The foundation also has a separate built-server process restart check. This smoke does not establish hosted HTTPS proxy streaming or Fly Volume persistence. MCP streaming delivers results only to active calls, and these reconnect runs were explicitly launched; no automatic interruption or idle-agent resumption is demonstrated.

See [agent usage instructions](../agents/codex.md) for shared JWT setup, yes/no wording, chosen IDs, wait/continue modes, timeout bounds, and recovery.
