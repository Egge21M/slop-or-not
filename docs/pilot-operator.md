# Private pilot operation

This release package targets one Fly app, one always-running Machine, and one persistent `slop_data` volume. Provisioning paid resources and deployment require a separately authorized operator. See [release evidence and remaining gates](research/release-smoke.md) before admitting testers. Keep the actual pilot URL out of public documentation, issues, and screenshots.

## Build and configuration

Use Bun 1.3.14 and the checked-in lockfile:

```sh
bun install --frozen-lockfile
bun run check
docker build -t slop-or-not:pilot .
```

The multi-stage Dockerfile builds Vite assets and the Bun server. The runtime contains Bun, `apps/server/dist`, `apps/server/migrations`, and `apps/web/dist`; no source dependency installation runs at startup. The directory layout preserves relative migration and asset paths. The process runs as root to write the Fly-mounted directory, whose initial ownership replaces the image's `/data` directory. The JSON `CMD` launches Bun directly so SIGTERM reaches its shutdown handler. Docker was unavailable in the implementation environment; an actual image build/run remains a release gate.

In a Docker-capable environment, first exercise the image with a disposable named volume and an existing local fixture `JWT_SECRET` environment variable:

```sh
docker volume create slop-release-smoke-data
docker run --rm --name slop-release-smoke -p 127.0.0.1:8080:8080 \
  --mount type=volume,src=slop-release-smoke-data,dst=/data \
  -e JWT_SECRET -e PUBLIC_ORIGIN=https://localhost:8080 slop-or-not:pilot
# From another terminal, check startup and signal/restart behavior:
curl --fail http://localhost:8080/health
docker restart --time 10 slop-release-smoke
curl --fail http://localhost:8080/health
```

Preserve this volume/secret for persistence checks. Local HTTP health access above is only a container-startup probe; the declared production origin expects HTTPS browser requests via TLS termination. Complete full browser/MCP/persistence acceptance through the actual Fly HTTPS origin below, including correct mounted-volume permissions.

For a managed environment whose HTTPS proxy requires a session CA, preserve its Docker proxy configuration and pass the public CA as a BuildKit secret, without disabling TLS verification or copying the CA into an image:

```sh
docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -t slop-or-not:pilot .
```

Edit `fly.toml`: replace `REPLACE_WITH_PRIVATE_APP_NAME` in `app` and `PUBLIC_ORIGIN` together; choose the region before creating the volume. `PUBLIC_ORIGIN` must be the actual HTTPS origin, without credentials, path, query, or fragment. Production startup rejects a missing/invalid origin and requires an explicit absolute `DATABASE_PATH`; the supplied configuration uses `/data/slop.sqlite`. `JWT_SECRET` must contain at least 32 bytes and stay stable across releases and restarts. Never put it in `fly.toml`, a Docker build argument, a `VITE_` variable, or the repository.

For a direct built-server launch, supply the same environment and preserve the three runtime directories:

```sh
NODE_ENV=production PUBLIC_ORIGIN=https://YOUR_PRIVATE_HOST \
  DATABASE_PATH=/data/slop.sqlite PORT=8080 \
  bun apps/server/dist/index.js
```

The environment must also contain the stable `JWT_SECRET`. The server opens SQLite, applies checked-in migrations synchronously, reconciles expired content and acknowledged Undo deadlines, then listens. Migration failure stops startup. Migrations run on the volume-owning process, never a separate Fly release-command Machine. Generate new migrations with `bunx --bun drizzle-kit generate` from `apps/server`; review SQL/metadata and commit them. Never edit a deployed migration.

## First authorized deployment

Use the intended Fly account and organization. The following commands are an operator procedure, not actions performed during implementation. Set `SLOP_FLY_APP` to the chosen private app name and `SLOP_FLY_REGION` to the matching configured region:

```sh
fly apps create "$SLOP_FLY_APP"
fly volumes create slop_data --app "$SLOP_FLY_APP" \
  --region "$SLOP_FLY_REGION" --size 1 --scheduled-snapshots=false
bun -e 'console.log("JWT_SECRET=" + Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString("hex"))' \
  | fly secrets import --stage --app "$SLOP_FLY_APP"
fly config validate --strict
fly deploy --app "$SLOP_FLY_APP" --ha=false --strategy rolling
fly machines list --app "$SLOP_FLY_APP"
fly volumes list --app "$SLOP_FLY_APP"
fly checks list --app "$SLOP_FLY_APP"
```

Generate/import the secret **once**. Subsequent deploys retain it; changing it invalidates existing credentials. Expect exactly one app Machine attached to the one volume. Always pass `--ha=false`; the default deployment availability behavior can create extra Machines. Existing extra Machines are not removed by this flag: inspect and make a deliberate operator correction before proceeding. No autoscaler, replica, worker process, backup service, or manual snapshot is part of this pilot. [Fly availability](https://docs.fly.io/apps/app-availability/) and [configuration reference](https://docs.fly.io/reference/configuration/) describe these controls.

The mount's `scheduled_snapshots=false` covers newly created volumes. For every **existing** volume, explicitly disable scheduling and inspect its settings and snapshots:

```sh
fly volumes update VOLUME_ID --app "$SLOP_FLY_APP" --scheduled-snapshots=false
fly volumes show VOLUME_ID --app "$SLOP_FLY_APP"
fly volumes snapshots list VOLUME_ID --app "$SLOP_FLY_APP"
```

Disabling scheduling does not erase historical snapshots; they age out under their existing retention. Do not describe an existing installation as having no retained snapshots until inspection confirms it. A fresh volume created with scheduling disabled avoids that exception. See [Fly snapshot management](https://docs.fly.io/volumes/snapshots/).

## Health, streaming, and restart

Fly terminates TLS and forwards to Bun on port 8080. Frontend assets, `/api`, `/api/events`, and `/mcp` share the configured public HTTPS origin. Browser Origin and expected Host are checked. Public `GET /health` intentionally accepts the private probe Host and returns only `{ok:true}` after successful initialization; the HTTP service health check gates routing. A health-check failure does not itself restart the Machine.

Automatic stopping is off, automatic starting is disabled, and the process restart policy is `always`. The Fly proxy inactivity margin is 600 seconds; Bun disables idle timeouts for authenticated phone SSE and MCP requests. Phone SSE sends an immediate change signal and 15-second comment heartbeats with `Cache-Control: no-cache, no-transform`. A deletion emits `unavailable` and closes that Inbox's streams. Avoid adding compression or buffering around these endpoints. The existing `X-Accel-Buffering` header is an Nginx convention, not evidence that Fly disables buffering.

Use `fly machine restart MACHINE_ID --app "$SLOP_FLY_APP" --signal SIGTERM --time 10` for an ordinary restart. Keep the volume and secret. Brief restart/deploy downtime is accepted. Reconnect the already-paired phone and retrieve its Question with the original ID/JWT; an acknowledged binary choice must preserve its original deadline or already be committed. The phone reconnects with backoff and rebuilds current state from an authenticated Inbox fetch; disconnected clients do not answer or cancel Questions.

Before the pilot, complete the hosted gate with latest stable Chrome and real Codex on the actual HTTPS endpoint. Follow the [tester guide](pilot-tester.md), retain sanitized versions and timings, and verify:

1. A paired phone receives a delayed Question and three individual heartbeat chunks approximately 15 seconds apart through the Fly edge. Record each chunk's arrival time, not a completed response body; do not record Authorization headers/JWTs.
2. Deliberately disconnect its stream. Observe reconnect/backoff and an authoritative `/api/inbox` fetch, then the missed Question, without replacing a manually selected open card.
3. Run both agent modes. Wait consumes a committed phone Response; continue does independent work then retrieves. A timed-out wait leaves the Question pending and a reconnect retrieves the same outcome.
4. Acknowledge a binary choice, restart the sole Machine during its Undo window, and reconnect with the same credential. Check its original deadline and eventual outcome. Retrieve previously pending and committed Questions and read history after the restart.
5. Inspect Machine count, volume attachment, snapshot scheduling, and service checks again. Exercise authenticated deletion from one device and confirm every paired device/agent loses access.

Use browser stream instrumentation or a short fetch reader from the open app, obtaining the credential from localStorage without printing it. Count the server's `: heartbeat` comments in individual chunks. Remove diagnostic instrumentation afterward. Local proxy success cannot establish Fly edge buffering, HTTPS enforcement, mounted-volume behavior, or platform restart persistence.

For a repeatable chunk check, run this from the paired HTTPS page's browser console while keeping that page open. It prints only chunk kinds and relative arrival times, closes after three heartbeats, and never prints the credential:

```js
const probe = new AbortController();
const started = performance.now();
const response = await fetch("/api/events", {
  headers: { authorization: `Bearer ${localStorage.getItem("slop-or-not:credential")}` },
  signal: probe.signal,
});
if (!response.ok) throw new Error(`Stream status ${response.status}`);
const reader = response.body.getReader();
let heartbeats = 0;
let pending = "";
const decoder = new TextDecoder();
try {
  while (heartbeats < 3) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error("Stream closed before three heartbeats");
    const atMs = Math.round(performance.now() - started);
    pending += decoder.decode(chunk.value, { stream: true });
    let boundary;
    while ((boundary = pending.indexOf("\n\n")) !== -1) {
      const frame = pending.slice(0, boundary);
      pending = pending.slice(boundary + 2);
      const kind = frame.includes(": heartbeat") ? "heartbeat" : "event";
      if (kind === "heartbeat") heartbeats++;
      console.log({ kind, atMs });
    }
  }
} finally { probe.abort(); await reader.cancel().catch(() => {}); }
```

Have an agent submit during the observation to confirm a delayed event arrives before completion. Batched frames sharing a late timestamp can indicate buffering and need investigation. Repeat after reconnection/restart. This diagnostic is an additional authenticated stream; the phone's own stream/reconciliation must also be checked in the browser network panel without saving headers.

## Pilot boundaries

Only distribute the URL privately. Anyone who discovers it can create an Inbox; there is no invitation or registration gate. Anyone holding an Inbox's JWT is trusted to submit, read, answer, and delete its contents. Foreground-only phone updates require the app to be open. There is no automatic idle-Codex interruption/resumption, credential recovery, backup recovery, or forensic disk-erasure promise. Finished content expires after seven days, leaving an ID/fingerprint replay marker until Inbox deletion. Ordinary restarts retain state; an irrecoverable volume failure may lose Inboxes. See [the agreed scope](technical-scope.md).
