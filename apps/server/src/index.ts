import { createApplication } from "./app";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
const databasePath = process.env.DATABASE_PATH ?? "./data/slop.sqlite";
const jwtSecret = process.env.JWT_SECRET;
let publicOrigin = process.env.PUBLIC_ORIGIN;
if (process.env.NODE_ENV === "production") {
  let url: URL | undefined;
  try { url = publicOrigin ? new URL(publicOrigin) : undefined; } catch {}
  if (!url || url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash)
    throw new Error("PUBLIC_ORIGIN must be a public HTTPS origin without credentials, path, query, or fragment in production");
  publicOrigin = url.origin;
  if (!process.env.DATABASE_PATH || !isAbsolute(databasePath))
    throw new Error("DATABASE_PATH must be an explicit absolute path on persistent storage in production");
}
if (!jwtSecret)
  throw new Error(
    "JWT_SECRET is required (at least 32 bytes; keep it stable across restarts)",
  );
if (databasePath !== ":memory:")
  mkdirSync(dirname(databasePath), { recursive: true });
const application = createApplication({
  databasePath,
  jwtSecret,
  publicOrigin,
  webDirectory: new URL("../../web/dist", import.meta.url).pathname,
});
const server = Bun.serve({
  hostname: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 3000),
  fetch(request, server) {
    const path = new URL(request.url).pathname;
    if (path === "/api/events" || path === "/mcp") server.timeout(request, 0);
    return application.fetch(request);
  },
});
console.log(`Slop or Not listening on port ${server.port}`);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  server.stop(true);
  await application.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
