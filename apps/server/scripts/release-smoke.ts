// Focused local release acceptance. This does not certify the Fly HTTPS edge.
// Driver/browser are operator-selected and are not production dependencies.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { listeningPort } from "./process-readiness";
const modulePath = process.env.SLOP_PLAYWRIGHT_MODULE;
const chromePath = process.env.SLOP_CHROME_PATH;
if (!modulePath || !chromePath) throw new Error("Set SLOP_PLAYWRIGHT_MODULE and SLOP_CHROME_PATH");
const { chromium } = await import(modulePath);
const source = new URL("../../..", import.meta.url).pathname;
const directory = await mkdtemp("/tmp/slop-release-");
for (const pattern of ["apps/server/dist/**", "apps/server/migrations/**", "apps/web/dist/**"]) {
  for await (const relative of new Bun.Glob(pattern).scan({ cwd: source, onlyFiles: true })) {
    await mkdir(dirname(`${directory}/${relative}`), { recursive: true });
    await Bun.write(`${directory}/${relative}`, Bun.file(`${source}/${relative}`));
  }
}
const jwtSecret = "temporary-release-fixture-secret-not-a-pilot-credential";
let backend = "";
let child: ReturnType<typeof Bun.spawn> | undefined;
let offline = false;
const streams = new Set<AbortController>();
const streamEvidence: { atMs: number; kind: string }[] = [];
const began = performance.now();
let streamRequests = 0;
let snapshotRequests = 0;
const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request, server) {
  const url = new URL(request.url);
  const stream = url.pathname === "/api/events";
  if (stream) {
    streamRequests++;
    server.timeout(request, 0);
    if (offline) return new Response("temporarily offline", { status: 503 });
  }
  if (url.pathname === "/api/inbox" && request.method === "GET") snapshotRequests++;
  const headers = new Headers(request.headers);
  headers.set("host", proxy.url.host);
  // Simulate TLS termination locally; this is not real HTTPS or Fly validation.
  if (headers.get("origin") === proxy.url.origin) headers.set("origin", `https://${proxy.url.host}`);
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  if (stream) streams.add(abort);
  try {
    const response = await fetch(`${backend}${url.pathname}${url.search}`, {
      method: request.method, headers, signal: abort.signal,
      ...(request.method !== "GET" && request.method !== "HEAD" ? { body: await request.arrayBuffer() } : {}),
    });
    if (!stream || !response.body) return response;
    const reader = response.body.getReader();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            const content = new TextDecoder().decode(chunk.value);
            for (const kind of ["heartbeat", "changed", "unavailable"])
              if (content.includes(kind)) streamEvidence.push({ atMs: Math.round(performance.now() - began), kind });
            controller.enqueue(chunk.value);
          }
        } catch { /* An intentional disconnect closes only this local transport. */ }
        finally { streams.delete(abort); if (!cancelled) controller.close(); }
      },
      cancel() { cancelled = true; abort.abort(); },
    });
    return new Response(body, { status: response.status, headers: response.headers });
  } catch { streams.delete(abort); return new Response("temporarily offline", { status: 503 }); }
} });
const origin = proxy.url.origin;
async function start() {
  child = Bun.spawn([process.execPath, "apps/server/dist/index.js"], {
    cwd: directory,
    env: { ...process.env, NODE_ENV: "production", PUBLIC_ORIGIN: `https://${proxy.url.host}`, HOST: "127.0.0.1", PORT: "0", DATABASE_PATH: `${directory}/inbox.sqlite`, JWT_SECRET: jwtSecret },
    stdout: "pipe", stderr: "pipe",
  });
  const port = await listeningPort(child);
  backend = `http://127.0.0.1:${port}`;
}
async function stop() { child?.kill("SIGTERM"); await child?.exited; child = undefined; }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
async function until(check: () => Promise<boolean> | boolean, message: string, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await Bun.sleep(40); }
  throw new Error(message);
}
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (error: Error) => errors.push(error.message));
let token = "";
async function call(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${origin}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert(response.ok, `${method} ${path}: ${response.status}`);
  return response.json() as Promise<any>;
}
const questions = new Map<string, string>();
async function submit(label: string) {
  const id = Bun.randomUUIDv7(); questions.set(label, id);
  await call("/api/questions", "POST", { questionId: id, wording: `Should we ${label}?`, project: "release-smoke", agentSession: label, supportingMarkdown: "**Review** this change.\n\n```ts\nconst safe = true;\n```" });
  return id;
}
const card = page.getByRole("article", { name: "Question card" });
const list = page.getByRole("region", { name: "Pending Questions" });
async function selected(label: string) { await card.getByRole("heading", { name: `Should we ${label}?`, exact: true }).waitFor(); }
async function answered(label: string, value: string, custom = false) {
  await until(async () => {
    const outcome = await call(`/api/questions/${questions.get(label)}`);
    return outcome.state === "answered" && (custom ? outcome.response?.text === value : outcome.response?.value === value);
  }, `${label} Response must commit`);
}
async function swipe(direction: "right" | "left" | "up") {
  await card.locator("[data-question-gesture]").scrollIntoViewIfNeeded();
  const bounds = await card.locator("[data-question-gesture]").boundingBox();
  assert(bounds, "Gesture region visible");
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + Math.min(bounds.height - 10, 130) };
  const end = { x: start.x + (direction === "right" ? 120 : direction === "left" ? -120 : 0), y: start.y - (direction === "up" ? 110 : 0) };
  const session = await context.newCDPSession(page);
  try {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...start, radiusX: 1, radiusY: 1, force: 1 }] });
    for (let step = 1; step <= 8; step++) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8, radiusX: 1, radiusY: 1, force: 1 }] });
      await Bun.sleep(20);
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally { await session.detach(); }
}
try {
  await start();
  assert((await fetch(`${origin}/health`)).ok, "Migrated bundle healthy");
  await page.goto(origin);
  await page.getByRole("button", { name: "Create Inbox", exact: true }).click();
  await page.getByText("Live while open", { exact: true }).waitFor();
  token = await page.evaluate(() => localStorage.getItem("slop-or-not:credential"));
  assert(token, "Phone stores shared credential");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByText("Pair agents & save credential", { exact: true }).click();
  assert(await page.getByLabel("MCP endpoint", { exact: true }).inputValue() === `${origin}/mcp`, "Same-origin MCP endpoint");
  await page.getByRole("button", { name: "Copy credential", exact: true }).click();
  assert(await page.evaluate(() => navigator.clipboard.readText()) === token, "Credential copy");
  await page.getByText("Pair agents & save credential", { exact: true }).click();
  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const second = await secondContext.newPage();
  await second.goto(origin);
  await second.getByLabel("Join with a saved credential", { exact: true }).fill(token);
  await second.getByRole("button", { name: "Join Inbox", exact: true }).click();
  await second.getByText("Live while open", { exact: true }).waitFor();
  await secondContext.close();
  await submit("undo a right swipe"); await selected("undo a right swipe");
  await swipe("right"); await card.getByRole("button", { name: "Undo", exact: true }).click();
  assert((await call(`/api/questions/${questions.get("undo a right swipe")}`)).provisional === null, "Undo withdraws provisional swipe");
  await card.getByRole("button", { name: "Yes", exact: true }).click();
  await answered("undo a right swipe", "yes");
  await submit("commit a right swipe"); await selected("commit a right swipe"); await swipe("right"); await answered("commit a right swipe", "yes");
  await submit("commit a left swipe"); await selected("commit a left swipe"); await swipe("left"); await answered("commit a left swipe", "no");
  await submit("use No button"); await selected("use No button"); await card.getByRole("button", { name: "No", exact: true }).click(); await answered("use No button", "no");
  await submit("send a custom answer"); await selected("send a custom answer"); await swipe("up");
  await card.getByLabel("Custom answer", { exact: true }).fill("Yes, but preserve the database.");
  await card.getByRole("button", { name: "Send", exact: true }).click(); await answered("send a custom answer", "Yes, but preserve the database.", true);
  await submit("use Custom button"); await selected("use Custom button");
  await card.getByRole("button", { name: "Custom answer", exact: true }).click();
  await card.getByLabel("Custom answer", { exact: true }).fill("Use the documented release path.");
  await card.getByRole("button", { name: "Send", exact: true }).click(); await answered("use Custom button", "Use the documented release path.", true);
  await submit("keep an open card"); await selected("keep an open card");
  const priority = await submit("promote priority"); await call(`/api/questions/${priority}/priority`, "POST");
  await list.getByRole("button", { name: /Should we promote priority/ }).getByText("Priority", { exact: true }).waitFor();
  await selected("keep an open card");
  await list.getByRole("button", { name: /Should we promote priority/ }).click(); await selected("promote priority");
  assert((await call("/api/inbox")).questions.every((question: any) => question.state === "pending"), "Manual selection does not answer");
  const snapshotsBefore = snapshotRequests;
  const streamsBefore = streamRequests;
  offline = true; for (const stream of streams) stream.abort();
  await page.getByText("Reconnecting…", { exact: true }).waitFor();
  const missed = await submit("recover an offline update");
  offline = false;
  await list.getByRole("button", { name: /Should we recover an offline update/ }).waitFor();
  await selected("promote priority");
  assert(snapshotRequests > snapshotsBefore && streamRequests > streamsBefore, "Reconnect fetches authoritative Inbox and authenticates a new stream");
  await call(`/api/questions/${priority}/cancel`, "POST");
  await call(`/api/questions/${questions.get("keep an open card")}/cancel`, "POST");
  await selected("recover an offline update");
  await card.getByRole("button", { name: "Yes", exact: true }).click();
  await card.getByRole("button", { name: "Undo", exact: true }).waitFor();
  const provisional = (await call(`/api/questions/${missed}`)).provisional;
  assert(provisional?.deadline && provisional.value === "yes", "Acknowledged Undo deadline exists");
  const previousPid = child!.pid;
  await stop();
  await start();
  assert(child!.pid !== previousPid, "Actual server process replaced");
  const restored = await call(`/api/questions/${missed}`);
  if (restored.state === "pending") assert(restored.provisional.deadline === provisional.deadline, "Restart does not reset acknowledged deadline");
  else assert(restored.response?.value === "yes", "Overdue binary choice reconciled on startup");
  await answered("recover an offline update", "yes");
  await page.getByRole("heading", { name: "You're all caught up", exact: true }).waitFor();
  assert(await page.evaluate(() => localStorage.getItem("slop-or-not:credential")) === token, "Same credential after process restart");
  await page.getByText(/^Response history \(/).click();
  await page.getByRole("article", { name: "History Response" }).filter({ hasText: "Yes, but preserve the database." }).waitFor();
  // Observe separate heartbeat chunks on the live browser stream, beyond Bun's default idle timeout.
  const heartbeatStart = streamEvidence.filter(event => event.kind === "heartbeat").length;
  await until(() => streamEvidence.filter(event => event.kind === "heartbeat").length >= heartbeatStart + 3, "Three live heartbeat chunks must arrive", 55000);
  assert(errors.length === 0, `Unexpected page errors: ${errors.join(", ")}`);
  if (process.env.SLOP_RELEASE_SCREENSHOT) await page.screenshot({ path: process.env.SLOP_RELEASE_SCREENSHOT, fullPage: true });
  page.once("dialog", (dialog: any) => dialog.accept());
  await page.getByRole("button", { name: "Delete Inbox", exact: true }).click();
  await page.getByRole("button", { name: "Create Inbox", exact: true }).waitFor();
  assert((await fetch(`${origin}/api/inbox`, { headers: { authorization: `Bearer ${token}` } })).status === 401, "Deleted Inbox credential rejected");
  const evidence = { result: "passed", versions: { bun: Bun.version, chrome: browser.version() }, viewport: "390x844 touch", artifact: "bundle + checked-in migrations + Vite assets; no node_modules", checks: ["phone pairing/copy/token paste", "Yes/No/Custom controls", "right/left/up touch swipes", "Undo", "stable open card/priority/manual selection", "authenticated SSE reconnect and authoritative refresh", "actual process restart/same DB/JWT/persisted deadline", "history", "Inbox deletion"], streamRequests, snapshotRequests, streamEvidence, limits: "Local HTTP proxy simulates TLS-origin forwarding only; Docker image and hosted Fly HTTPS/volume/proxy are unverified." };
  const output = process.env.SLOP_RELEASE_EVIDENCE ?? "/tmp/slop-release-smoke.json";
  await Bun.write(output, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ result: evidence.result, versions: evidence.versions, evidence: output, checks: evidence.checks }));
} finally {
  for (const stream of streams) stream.abort();
  await browser.close(); proxy.stop(true); await stop(); await rm(directory, { recursive: true, force: true });
}
