import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { listeningPort } from "../scripts/process-readiness";

test("production rejects a missing or invalid public HTTPS origin before serving", async () => {
  for (const origin of [undefined, "garbage", "http://pilot.example", "https://user:secret@pilot.example", "https://pilot.example/path", "https://pilot.example?token=test", "https://pilot.example#test"]) {
    const child = Bun.spawn([process.execPath, "apps/server/src/index.ts"], {
      cwd: new URL("../../..", import.meta.url).pathname,
      env: { ...process.env, NODE_ENV: "production", PUBLIC_ORIGIN: origin, JWT_SECRET: "startup-fixture-secret-at-least-32bytes", DATABASE_PATH: ":memory:", PORT: "0" },
      stdout: "pipe", stderr: "pipe",
    });
    try {
      const exit = await Promise.race([child.exited, Bun.sleep(1000).then(() => null)]);
      expect(exit).not.toBeNull();
      expect(exit).not.toBe(0);
      expect(await new Response(child.stderr).text()).toContain("PUBLIC_ORIGIN");
    } finally { child.kill(); await child.exited; }
  }
}, 10000);

test("production serves after startup migrations and checks the configured origin", async () => {
  const directory = await mkdtemp("/tmp/slop-startup-");
  // The process boundary permits diagnostics before its listening message.
  // A separate first chunk reliably exposes a one-read readiness assumption.
  const diagnostic = `${directory}/startup-diagnostic.ts`;
  await Bun.write(diagnostic, 'console.log("Starting release startup probe"); await Bun.sleep(20);');
  const child = Bun.spawn([process.execPath, "--preload", diagnostic, "apps/server/src/index.ts"], {
    cwd: new URL("../../..", import.meta.url).pathname,
    env: { ...process.env, NODE_ENV: "production", PUBLIC_ORIGIN: "https://pilot.example", JWT_SECRET: "startup-fixture-secret-at-least-32bytes", DATABASE_PATH: `${directory}/inbox.sqlite`, HOST: "127.0.0.1", PORT: "0" },
    stdout: "pipe", stderr: "pipe",
  });
  try {
    const port = await listeningPort(child);
    expect(port).toBeDefined();
    const url = `http://127.0.0.1:${port}`;
    expect((await fetch(`${url}/health`)).status).toBe(200);
    expect((await fetch(`${url}/api/inboxes`, { method: "POST" })).status).toBe(403);
    const paired = await fetch(`${url}/api/inboxes`, { method: "POST", headers: { host: "pilot.example", origin: "https://pilot.example" } });
    expect(paired.status).toBe(201);
    const { token } = await paired.json() as { token: string };
    expect((await fetch(`${url}/api/inbox`, { headers: { host: "pilot.example", authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await fetch(`${url}/api/inbox`, { headers: { host: "pilot.example", origin: "https://other.example", authorization: `Bearer ${token}` } })).status).toBe(403);
  } finally { child.kill("SIGTERM"); await child.exited; await rm(directory, { recursive: true, force: true }); }
}, 10000);

test("production requires an explicit durable absolute database path", async () => {
  for (const databasePath of [undefined, ":memory:", "./data/slop.sqlite"]) {
    const child = Bun.spawn([process.execPath, "apps/server/src/index.ts"], {
      cwd: new URL("../../..", import.meta.url).pathname,
      env: { ...process.env, NODE_ENV: "production", PUBLIC_ORIGIN: "https://pilot.example", JWT_SECRET: "startup-fixture-secret-at-least-32bytes", DATABASE_PATH: databasePath, PORT: "0" },
      stdout: "pipe", stderr: "pipe",
    });
    try {
      const exit = await Promise.race([child.exited, Bun.sleep(1000).then(() => null)]);
      expect(exit).not.toBeNull();
      expect(exit).not.toBe(0);
      expect(await new Response(child.stderr).text()).toContain("DATABASE_PATH");
    } finally { child.kill(); await child.exited; }
  }
}, 10000);
