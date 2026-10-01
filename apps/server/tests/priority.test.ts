import { expect, test } from "bun:test";
import { createStore } from "../src/store";

const oldest = "01993940-1000-7000-8000-000000000071";
const middle = "01993940-1000-7000-8000-000000000072";
const newest = "01993940-1000-7000-8000-000000000073";
function input(questionId: string, agentSession: string) {
  return { questionId, wording: "Should we proceed?", project: "queue", agentSession };
}

test("priority Questions retain original creation order ahead of normal Questions across restart", () => {
  const databasePath = `/tmp/slop-priority-${crypto.randomUUID()}.sqlite`;
  let now = 1000;
  let store = createStore({ databasePath, clock: () => now });
  try {
    const inbox = store.createInbox();
    expect(store.submit(inbox, input(oldest, "agent-a"))).toMatchObject({ state: "pending", prio: false });
    now = 2000;
    store.submit(inbox, input(middle, "agent-b"));
    now = 3000;
    store.submit(inbox, input(newest, "agent-a"));
    expect(store.snapshot(inbox).questions.map(q => q.questionId)).toEqual([oldest, middle, newest]);
    now = 9000;
    store.prioritize(inbox, newest);
    expect(store.snapshot(inbox).questions.map(q => q.questionId)).toEqual([newest, oldest, middle]);
    expect(store.prioritize(inbox, oldest)).toMatchObject({ prio: true, createdAt: 1000 });
    expect(store.snapshot(inbox).questions.map(q => q.questionId)).toEqual([oldest, newest, middle]);
    store.close();
    store = createStore({ databasePath, clock: () => now });
    expect(store.snapshot(inbox).questions.map(q => q.questionId)).toEqual([oldest, newest, middle]);
    expect(store.get(inbox, oldest)).toMatchObject({ prio: true, createdAt: 1000 });
  } finally {
    store.close();
  }
});

test("HTTP Priority commands are idempotent, scoped to an Inbox, and announce authoritative queue changes", async () => {
  const { createApplication } = await import("../src/app");
  const app = createApplication({ databasePath: ":memory:", jwtSecret: "test-signing-secret-at-least-thirty-two-bytes" });
  const call = (path: string, token?: string, method = "GET", body?: unknown) => app.fetch(new Request(`http://localhost${path}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  const abort = new AbortController();
  try {
    const first = await (await call("/api/inboxes", undefined, "POST")).json() as { token: string };
    const second = await (await call("/api/inboxes", undefined, "POST")).json() as { token: string };
    await call("/api/questions", first.token, "POST", input(oldest, "agent-a"));
    const stream = await app.fetch(new Request("http://localhost/api/events", {
      headers: { authorization: `Bearer ${first.token}` }, signal: abort.signal,
    }));
    const reader = stream.body!.getReader();
    await reader.read();
    const path = `/api/questions/${oldest}/priority`;
    expect((await call(path, undefined, "POST")).status).toBe(401);
    expect((await call(path, second.token, "POST")).status).toBe(404);
    const promoted = await call(path, first.token, "POST");
    expect(promoted.status).toBe(200);
    const result = await promoted.json();
    expect(result).toMatchObject({ questionId: oldest, state: "pending", prio: true });
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: changed");
    expect(await (await call(path, first.token, "POST")).json()).toEqual(result);
    expect(await (await call("/api/questions", first.token, "POST", input(oldest, "agent-a"))).json()).toEqual(result);
    expect(await (await call("/api/inbox", first.token)).json()).toMatchObject({ questions: [result] });
    expect(await (await call("/api/inbox", second.token)).json()).toMatchObject({ questions: [] });
    abort.abort();
    await reader.cancel();
  } finally {
    abort.abort();
    await app.close();
  }
});

test("an authenticated agent can promote a Question through independent MCP requests", async () => {
  const { Client, StreamableHTTPClientTransport } = await import("@modelcontextprotocol/client");
  const { createApplication } = await import("../src/app");
  const app = createApplication({ databasePath: ":memory:", jwtSecret: "test-signing-secret-at-least-thirty-two-bytes" });
  const { token } = await (await app.fetch(new Request("http://localhost/api/inboxes", { method: "POST" }))).json() as { token: string };
  async function tool(name: string, args: Record<string, unknown>) {
    const client = new Client({ name: "priority-test", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
        fetch: (url, init) => app.fetch(new Request(url.toString(), init)),
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }));
      return await client.callTool({ name, arguments: args });
    } finally { await client.close(); }
  }
  try {
    await tool("submit_question", input(oldest, "agent-a"));
    const promoted = await tool("prioritize_question", { questionId: oldest });
    expect(promoted.isError).not.toBe(true);
    expect(promoted.structuredContent).toMatchObject({ questionId: oldest, prio: true, state: "pending" });
    expect((await tool("prioritize_question", { questionId: oldest })).structuredContent).toEqual(promoted.structuredContent);
    expect((await tool("get_response", { questionId: oldest })).structuredContent).toEqual(promoted.structuredContent);
  } finally { await app.close(); }
});

test("a deadline commits before Priority promotion and removes the Question from pending selection", () => {
  let now = 1000;
  const store = createStore({ databasePath: ":memory:", clock: () => now });
  try {
    const inbox = store.createInbox();
    store.submit(inbox, input(oldest, "agent-a"));
    store.submit(inbox, input(middle, "agent-b"));
    store.respond(inbox, oldest, "yes", crypto.randomUUID());
    now = 4000;
    expect(store.prioritize(inbox, oldest)).toMatchObject({
      state: "answered", prio: false, response: { type: "binary", value: "yes" },
    });
    expect(store.snapshot(inbox).questions.map(q => q.questionId)).toEqual([middle]);
    const terminal = store.get(inbox, oldest);
    expect(store.prioritize(inbox, oldest)).toEqual(terminal);
  } finally { store.close(); }
});
