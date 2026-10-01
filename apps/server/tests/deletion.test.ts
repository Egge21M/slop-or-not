import { afterEach, expect, test } from "bun:test";
import { createApplication } from "../src/app";

const apps: ReturnType<typeof createApplication>[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
const secret = "test-signing-secret-at-least-thirty-two-bytes";
function application(databasePath = ":memory:", clock = () => 1000) {
  const app = createApplication({ databasePath, jwtSecret: secret, clock });
  apps.push(app);
  return app;
}
async function request(app: ReturnType<typeof application>, path: string, token?: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  return app.fetch(new Request(`http://localhost${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}
const question = (suffix: string) => ({
  questionId: `01993940-1000-7000-8000-0000000000${suffix}`,
  wording: "Can I proceed?", project: "deletion", agentSession: "codex",
  supportingMarkdown: "Keep **compatibility**.",
});
async function pair(app: ReturnType<typeof application>) {
  return await (await request(app, "/api/inboxes", undefined, {})).json() as { token: string; inboxId: string };
}

test("deleting an Inbox revokes every old-token operation across restart while another Inbox and its Undo deadline survive", async () => {
  const databasePath = `/tmp/slop-deletion-${crypto.randomUUID()}.sqlite`;
  let now = 1000;
  let app = application(databasePath, () => now);
  try {
    const deleted = await pair(app), other = await pair(app);
    const expired = question("a1"), retained = question("a2"), pending = question("a3"), undo = question("a4");
    await request(app, "/api/questions", deleted.token, expired);
    await request(app, `/api/questions/${expired.questionId}/custom-response`, deleted.token, { text: "Old answer" });
    now += 7 * 24 * 60 * 60 * 1000;
    expect(await (await request(app, `/api/questions/${expired.questionId}`, deleted.token)).json()).toEqual({ questionId: expired.questionId, state: "expired" });
    for (const q of [retained, pending, undo]) await request(app, "/api/questions", deleted.token, q);
    await request(app, `/api/questions/${retained.questionId}/custom-response`, deleted.token, { text: "Retained answer" });
    const choiceId = crypto.randomUUID();
    await request(app, `/api/questions/${undo.questionId}/response`, deleted.token, { value: "yes", choiceId });
    await request(app, "/api/questions", other.token, undo);
    await request(app, `/api/questions/${undo.questionId}/response`, other.token, { value: "no", choiceId });
    expect((await request(app, "/api/inbox", undefined, undefined, "DELETE")).status).toBe(401);
    expect((await request(app, "/api/inbox", deleted.token, undefined, "DELETE")).status).toBe(200);
    const rejectsOldCredential = async () => {
      for (const path of ["/api/inbox", "/api/history", "/api/events", `/api/questions/${pending.questionId}`])
        expect((await request(app, path, deleted.token)).status).toBe(401);
      for (const q of [expired, retained, pending, undo])
        expect((await request(app, "/api/questions", deleted.token, q)).status).toBe(401);
      for (const [action, body] of [["response", { value: "no", choiceId }], ["custom-response", { text: "Replay" }], ["undo", { choiceId }], ["priority", {}], ["cancel", {}]] as const)
        expect((await request(app, `/api/questions/${undo.questionId}/${action}`, deleted.token, body)).status).toBe(401);
      expect((await request(app, "/mcp", deleted.token, {})).status).toBe(401);
      expect((await request(app, "/api/inbox", deleted.token, undefined, "DELETE")).status).toBe(401);
    };
    await rejectsOldCredential();
    now += 3000;
    expect(await (await request(app, `/api/questions/${undo.questionId}`, other.token)).json()).toMatchObject({ state: "answered", response: { type: "binary", value: "no", committedAt: now } });
    await app.close();
    app = application(databasePath, () => now);
    await rejectsOldCredential();
    expect(await (await request(app, "/api/history", other.token)).json()).toMatchObject({ questions: [{ ...undo, response: { value: "no" } }] });
    const fresh = await pair(app);
    expect(fresh.inboxId).not.toBe(deleted.inboxId);
    expect(await (await request(app, "/api/questions", fresh.token, expired)).json()).toMatchObject({ state: "pending" });
  } finally {
    await app.close();
    for (const suffix of ["", "-wal", "-shm"]) await Bun.file(`${databasePath}${suffix}`).delete().catch(() => {});
  }
});

test("deletion immediately releases an active agent wait and closes only that Inbox's phone stream after commitment", async () => {
  const { Client, StreamableHTTPClientTransport } = await import("@modelcontextprotocol/client");
  let now = 1000;
  const app = application(":memory:", () => now);
  const deleted = await pair(app), other = await pair(app);
  const q = question("b1");
  for (const paired of [deleted, other]) await request(app, "/api/questions", paired.token, q);
  const readers = await Promise.all([deleted, other].map(async ({ token }) =>
    (await request(app, "/api/events", token)).body!.getReader()));
  const [deletedReader, otherReader] = readers as [ReadableStreamDefaultReader<Uint8Array>, ReadableStreamDefaultReader<Uint8Array>];
  for (const reader of readers) await reader.read(); // Initial reconciliation event.
  const clients = [deleted, other].map(() => new Client(
    { name: "deletion-test", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  ));
  try {
    for (const [index, paired] of [deleted, other].entries()) {
      await clients[index]!.connect(new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
        fetch: (url, init) => app.fetch(new Request(url.toString(), init)),
        requestInit: { headers: { Authorization: `Bearer ${paired.token}` } },
      }));
    }
    const waiting = clients[0]!.callTool({ name: "wait_for_response", arguments: { questionId: q.questionId, waitMs: 20000 } });
    let otherSettled = false;
    const otherWaiting = clients[1]!.callTool({ name: "wait_for_response", arguments: { questionId: q.questionId, waitMs: 20000 } }).then((result) => { otherSettled = true; return result; });
    void waiting.catch(() => {});
    void otherWaiting.catch(() => {});
    await Bun.sleep(50);
    expect((await request(app, "/api/inbox", deleted.token, undefined, "DELETE")).status).toBe(200);
    expect(await Promise.race([waiting, Bun.sleep(1000).then(() => { throw new Error("Deleted Inbox wait was not released"); })])).toMatchObject({ isError: true, content: [{ type: "text", text: "Inbox unavailable" }] });
    const event = await deletedReader.read();
    expect(new TextDecoder().decode(event.value)).toBe("event: unavailable\ndata: {}\n\n");
    expect(app.store.hasInbox(deleted.inboxId)).toBe(false);
    expect((await deletedReader.read()).done).toBe(true);
    expect(otherSettled).toBe(false);
    await request(app, `/api/questions/${q.questionId}/response`, other.token, { value: "yes", choiceId: crypto.randomUUID() });
    now += 3000;
    await request(app, `/api/questions/${q.questionId}`, other.token);
    expect(await otherWaiting).toMatchObject({ structuredContent: { state: "answered", response: { value: "yes" } } });
    expect((await otherReader.read()).done).toBe(false);
    expect(await (await request(app, "/api/inbox", other.token)).json()).toMatchObject({ inboxId: other.inboxId, questions: [] });
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await Promise.all(readers.map((reader) => reader.cancel().catch(() => {})));
  }
});
