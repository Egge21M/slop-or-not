import { createProbe } from "./probe";
const token = process.env.SLOP_PROBE_TOKEN;
if (!token)
  throw new Error("Set SLOP_PROBE_TOKEN; never put credentials in the URL.");
const probe = createProbe({
  token,
  legacy: process.env.SLOP_PROBE_LEGACY === "1",
  trace: (event) => console.log(JSON.stringify(event)),
});
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 4317),
  idleTimeout: 30,
  fetch: probe.fetch,
});
console.log(
  JSON.stringify({
    listening: server.url.href,
    bun: Bun.version,
    legacy: process.env.SLOP_PROBE_LEGACY === "1",
  }),
);
process.on("SIGINT", async () => {
  await probe.close();
  server.stop(true);
  process.exit(0);
});
