# Agreed technical scope

Settled in the technical grilling session on 2026-10-01. These are requirements for the MVP, not a description of implemented code. The product scope and work breakdown remain in [scope issue #1](https://github.com/Egge21M/slop-or-not/issues/1) and its linked tickets.

## Stack and application shape

- Bun is the package manager, backend runtime, script runner, and test runner; TypeScript remains strict.
- Server orchestration uses ordinary TypeScript with async/await and explicit cancellation/resource cleanup. Effect is outside the MVP stack.
- Separate React/TypeScript web and Bun server workspaces share browser-safe request/response schemas and types. Replace the unused greeting CLI; a separate CLI product is outside scope.
- Initialize the web workspace using the shadcn Vite starter within the existing Bun workspace layout. Use its normal component/styling setup, rather than introducing an additional monorepo build system.
- Vite runs and builds under Bun. Bun serves the completed static frontend, HTTP API, and MCP endpoint from one origin in production. Vite proxies backend requests in development; Vite preview is not the production server.
- Latest stable Chrome is the supported browser. The phone UI uses browser Pointer Events for swipes and visible equivalent controls. Broader browser compatibility and offline answering are outside scope.
- Use Zod for request/tool schemas, jose for JWT signing and verification, and react-markdown for supporting text with raw HTML disabled. Keep safe default URL handling and do not add plugins that execute untrusted content.
- Resolve compatible stable dependency releases and lock them with Bun during implementation. Documentation examples using release candidates are not authorization to adopt prereleases.

## Persistence and lifecycle

- Use Drizzle with the native bun:sqlite adapter and one SQLite database on a persistent Fly Volume. Do not store durable state on the ephemeral Machine root filesystem.
- Generate and check in versioned SQL migrations. Apply unapplied migrations on the volume-owning server at startup before accepting traffic; fail startup on migration failure. Do not rely on a Fly release-command Machine to access the mounted database.
- SQLite is authoritative for Questions, immutable submission fingerprints, Responses, provisional binary choices/deadlines, and Inbox existence. In-memory connections and timers are delivery aids, not the only record of state.
- Finalization, Undo, cancellation, and competing responses use atomic synchronous database transitions. Asynchronous waits and network operations run outside synchronous SQLite transactions.
- Persist the acknowledged three-second deadline. On restart, reconcile overdue provisional choices without resetting their deadlines. An outcome is delivered only after its authoritative database transition commits.
- Pending Questions do not expire. Finished content expires after seven days; retain only the agreed Question ID/original-content fingerprint marker for replay protection. Expiry must remain effective after restart.
- Expiry and Inbox deletion remove content from application records. Forensic erasure of historical disk bytes is outside scope. No application backup or automatic Fly Volume snapshot retains a separate recovery copy.

## Authentication and phone updates

- The phone creates a pseudonymous Inbox and receives its shared, non-expiring JWT. Persist it in localStorage so the phone can reconnect and display/copy it for MCP configuration. Another browser joins by pasting the credential.
- Browser API requests and the fetch-based SSE stream use bearer authentication; agents use the same JWT at the MCP endpoint. No HttpOnly-cookie flow or separate human/agent role is introduced.
- Keep the JWT signing secret stable across deploys and restarts, configured as a server/Fly secret. Never bundle it into the frontend. Validate signatures and expected claims, then check that the authenticated Inbox still exists; a valid signature cannot resurrect a deleted Inbox.
- Keep credentials out of URLs and logs. Scope every question lookup, command, history read, and stream to the authenticated Inbox; validate the expected host/origin where applicable.
- The phone receives foreground updates through authenticated SSE using fetch, and uses ordinary HTTP requests for actions. Reconnect with backoff and rebuild current state from an authoritative Inbox fetch. Stream events do not replace durable state or promise event replay.
- The phone SSE stream is distinct from MCP protocol streaming. A disconnected phone or agent never supplies an answer or cancels a Question.

## MCP and Codex

- Use the official MCP TypeScript SDK v2 and its modern web-standard Bun handler, targeting the latest official specification (2026-07-28 as researched on 2026-10-01).
- The first ticket remains a live compatibility probe with the intended Codex client. Record the actual SDK, client, and negotiated protocol versions; report mismatches explicitly rather than silently downgrading.
- Investigate native Tasks/SSE delivery first; the accepted submit/retrieve/bounded-wait fallback remains available if Tasks is unsupported. Durable application state is independent of per-request SDK server instances and transient transport state.
- Agent waiting versus continuing independent work, timeout/reconnect behavior, and automatic-resumption limits must follow evidence from the probe. A custom host and draft Events integration are not selected.

## Deployment and pilot operation

- Deploy one Docker-packaged Fly app with one always-running Machine and one persistent volume. Disable automatic stopping, unintended replica creation, and automatic volume snapshots.
- Brief deployment/restart downtime is acceptable. Ordinary restart persistence is required; irrecoverable volume failure may lose Inboxes. Backups, disaster recovery, replication, and high availability are deferred.
- Serve the web app, API, SSE, and MCP through the same HTTPS origin. Configure streaming so proxy buffering, application idle timeouts, or abandoned connections do not silently break delivery; heartbeat/reconnect behavior is verified in the hosted smoke test.
- The private group is reached by keeping the deployment URL unshared. There is no invite-code gate or registration; anyone who discovers the URL can create an Inbox. Existing Inbox access still requires its JWT.
- Provide Fly configuration, reproducible build/start commands, migration/persistence settings, and operator/tester instructions. Actual paid resource provisioning or deployment is a separate action from producing the release package.

## Necessary verification

Use bun test for meaningful integration coverage of authentication isolation, idempotent submission, atomic outcome races, persisted Undo deadlines, and restart/expiry/deletion behavior. Reuse coverage across feature tickets instead of creating duplicative suites or imposing a coverage target.

Before the pilot, run a latest-stable Chrome phone-sized UI smoke test and a real Codex round trip, including swipes, Custom answer, SSE reconnect, wait/continue, and restart persistence. Record tested versions and limitations. A broad Playwright suite and multi-browser matrix are not required; add browser automation only where necessary to validate behavior reliably.

## Primary implementation references

- [Drizzle Bun SQLite integration](https://orm.drizzle.team/docs/sqlite/connect-bun-sqlite), [Bun Drizzle migration guide](https://bun.com/guides/ecosystem/drizzle), [Drizzle stable releases](https://github.com/drizzle-team/drizzle-orm/releases).
- [shadcn Vite starter](https://ui.shadcn.com/docs/installation/vite), [Bun Vite runtime guide](https://bun.com/guides/ecosystem/vite), [Vite production deployment](https://vite.dev/guide/static-deploy.html).
- [Official MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk), [web-standard runtime handler](https://ts.sdk.modelcontextprotocol.io/v2/serving/web-standard.html), [protocol negotiation](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions.html).
- [jose](https://github.com/panva/jose), [Zod](https://zod.dev/), [react-markdown](https://github.com/remarkjs/react-markdown).
- [Fly Volume constraints](https://docs.fly.io/volumes/overview/), [disabling volume snapshots](https://docs.fly.io/volumes/snapshots/), [SQLite deletion semantics](https://sqlite.org/pragma.html#pragma_secure_delete).
