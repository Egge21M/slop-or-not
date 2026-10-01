# Release acceptance evidence

Verified locally on 2026-10-01 for [release ticket #11](https://github.com/Egge21M/slop-or-not/issues/11). This is release-package evidence, not a deployed-pilot claim. No Fly app, paid resource, deployment, secret upload, snapshot, or public URL was created.

## Tested versions

Bun **1.3.14**, Chrome for Testing Stable **154.0.8037.92**, Playwright Core **1.56.1**, Codex CLI **0.159.2**, official MCP server/client SDK **2.2.0**. The phone viewport was **390×844** with mobile/touch enabled. Chrome version came from the official stable channel metadata and actual launched browser. Browser gestures used CDP touch input producing real Pointer Events, not synthetic DOM gesture events.

Real Codex again offered and negotiated MCP **2025-06-18**. The server explicitly supports this stateless compatibility path and the target **2026-07-28** revision. The newer revision remains covered by the existing SDK integration corpus, not demonstrated by this Codex client. Native Tasks and idle automatic interruption/resumption remain unsupported by the observed client contract.

## Local results

| Check | Evidence |
| --- | --- |
| Phone pairing and saving access | Created an Inbox in Chrome; localStorage retained the credential; native clipboard copied it; an independent browser context joined by token paste. The displayed MCP endpoint shared the page's origin. |
| Responses and gestures | Yes/No/Custom buttons and right/left/up touch swipes worked. Undo withdrew a provisional right swipe before commitment. Binary choices committed after acknowledgment; conditional Custom text was committed exactly. |
| Priority and navigation | Promotion did not replace an open card. Manual pending selection did not answer Questions. Existing priority-ordering corpus and [focused queue browser evidence](priority-inbox-smoke.md) cover original-time ordering. |
| Phone stream recovery | Bearer-authenticated SSE disconnected deliberately; Chrome showed reconnecting, opened a new stream, and made fresh authoritative Inbox requests. A Question submitted while disconnected appeared after recovery, with the selected card preserved. |
| Actual process restart | The script stopped the bundled Bun process with SIGTERM and started a different process against the same SQLite file and signing secret during an acknowledged binary Undo window. The original deadline was retained or already reconciled; the yes Response committed without resetting it. The same browser JWT, retained history, and prior Custom Responses survived. |
| Heartbeat chunks | After restart, the local forwarding proxy received separate heartbeat chunks at **34,287**, **49,286**, and **64,287 ms** from script start: gaps **14,999** and **15,001 ms**. These exceeded Bun's default idle timeout and arrived individually. This is local proxy evidence. |
| History and deletion | Read-only history displayed retained binary/Custom Responses and metadata. Confirmed deletion cleared browser pairing and the previous credential received HTTP 401. The existing deletion corpus covers all paired scopes, active waits, markers, and restart invalidation. |
| Real Codex wait | Submitted `pending`; a separately paired Chrome page clicked Yes during an active bounded wait; Codex consumed the committed `answered` binary yes result. |
| Real Codex continue | Submitted `pending`; Codex explained `17 × 19 = 323` before its next tool call; it then consumed the separate phone's committed yes through a bounded wait. |
| Real Codex timeout/reconnect | A 20-second wait hit a deliberately configured one-second client timeout. An authenticated lookup still reported pending. After phone commitment and application/database-owner recreation, a new real Codex process retrieved the same yes twice with the original ID and credential. The separate Chrome artifact flow establishes an actual server process restart. |
| Startup guards | A public process/HTTP test failed before each new guard and then passed: production rejects absent/invalid HTTPS origins and absent/in-memory/relative database paths. A valid-origin process applies startup migrations before pairing and rejects wrong Host/browser Origin. Private-host `/health` remains available. |

The [sanitized evidence](release-evidence/) contains phone stream arrival times, actual versions, protocol/tool traces, completed Codex items, and explicit assertions. No JWT or Authorization header is recorded. The screenshot taken by the optional local smoke collapses the pairing section before capture; it is not checked in. The continue-mode automatic approval initially rejected an external authenticated process. Inspection established that the exact harness sends only synthetic Question/arithmetic prompts, runs ephemeral Codex read-only from `/tmp`, and supplies the fixture JWT only to loopback MCP via its bearer environment variable. The evidence-based same-command retry was approved and passed; there is no remaining approval block for these local checks.

The final required `bun run check` passed: strict typechecks in all three workspaces, **41 Bun tests / 299 assertions / zero failures**, Vite frontend production build, and Bun server bundle build. Existing authentication, isolation, retries, atomic lifecycle, persisted Undo/restart, expiry, and deletion coverage was reused; no configuration-only tests or browser dependency were added to the production test pipeline.

After that final rebuild, the existing isolated artifact probe passed again: static frontend, startup migrations, authenticated Custom commitment, actual process restart, and same-JWT retrieval, with no node_modules present.

The merged integration check exposed a startup-test readiness race: one stdout chunk need not contain the listening line. A harmless preload diagnostic reproduced the same undefined-port failure deterministically. The test and optional release helper now accumulate complete lines across chunks, detect process exit, and apply a five-second deadline with captured stderr. Focused real-process diagnostics verified a split port was not truncated, exit status/stderr were retained, and a silent process timed out. Application behavior was unchanged; the required full check passed again after the repair.

## Repeat locally

Use separately installed Playwright Core, current stable Chrome, and an authenticated Codex CLI. These are optional smoke tools, not production dependencies. From the repository root:

```sh
bun install --frozen-lockfile
bun run check
export SLOP_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs
export SLOP_CHROME_PATH=/absolute/path/to/current-stable/chrome
bun apps/server/scripts/release-smoke.ts
bun apps/server/scripts/codex-smoke.ts wait
bun apps/server/scripts/codex-smoke.ts continue
bun apps/server/scripts/codex-smoke.ts timeout
```

The release helper copies only server bundle, migrations, and Vite assets into an isolated temporary directory with **no node_modules or package manifests**. It launches actual production-configured server processes with an absolute database path and stable fixture secret. A local HTTP forwarding proxy simulates TLS Host/Origin forwarding and deliberate SSE loss; it does not provide actual HTTPS. The helper cleans its temporary database and processes. `SLOP_RELEASE_EVIDENCE` chooses its sanitized JSON output (default `/tmp/slop-release-smoke.json`); `SLOP_RELEASE_SCREENSHOT` optionally chooses a screenshot path. Evidence includes only synthetic content, timings, and versions.

The Codex helper uses ephemeral client processes with synthetic Questions, explicit test-only tool approval, and no repository source in the prompt. It does not edit saved user permissions. `SLOP_SMOKE_EVIDENCE` chooses its output directory (default `/tmp/slop-production-codex-evidence`). Raw local stdout/stderr should be inspected/sanitized before sharing; the checked-in release evidence retains completed items/trace and omits raw stderr. Chrome needed elevated execution in this executor because sandbox socket restrictions crashed its process; loopback server/browser ran in the same execution environment.

## Remaining release gates

**Docker image build/run remains unverified:** this executor has no Docker/podman executable or local daemon socket. The isolated artifact passes with the Docker runtime's intended directory layout, but that does not prove image construction, base-image availability, mounted-volume permissions, or signal delivery inside a container. An authorized operator must build/run the checked-in Dockerfile in a Docker-capable environment before release.

**Hosted Fly HTTPS smoke remains unverified:** no authorized deployed app URL was available. Local success cannot establish real TLS enforcement, Fly edge buffering/heartbeat arrival, mounted-volume attachment, platform timeouts, single-Machine count, snapshot settings, or hosted restart persistence. Follow the repeatable [operator procedure](../pilot-operator.md#health-streaming-and-restart) on the actual authorized Fly app, record individual chunk timestamps and versions, and complete [the tester session](../pilot-tester.md#acceptance-session). Keep the pilot URL private and credentials out of captured logs. Do not mark this hosted gate passed from the local evidence.
