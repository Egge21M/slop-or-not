import { afterEach, expect, test } from "bun:test";
import type { QuestionView } from "@slop-or-not/shared";
import { createApplication } from "../src/app";

const jwtSecret = "cancel-test-signing-secret-at-least-thirty-two-bytes";
const apps: ReturnType<typeof createApplication>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
function application(options: { databasePath?: string; clock?: () => number } = {}) {
  const app = createApplication({ databasePath: ":memory:", jwtSecret, ...options });
  apps.push(app);
  return app;
}
async function request(app: ReturnType<typeof application>, path: string, token?: string, body?: unknown) {
  return app.fetch(new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}
const question = {
  questionId: "01993940-1000-7000-8000-000000000008",
  wording: "Should I keep this endpoint?",
  project: "cancellation",
  agentSession: "original-agent",
  supportingMarkdown: "Keep **original** context.",
};
async function pair(app: ReturnType<typeof application>) {
  return (await (await request(app, "/api/inboxes", undefined, {})).json()) as { token: string; inboxId: string };
}

test("explicit cancellation is final, idempotent, immutable, authenticated and Inbox scoped", async () => {
  const app = application();
  const { token } = await pair(app);
  await request(app, "/api/questions", token, question);
  const path = `/api/questions/${question.questionId}`;
  expect((await request(app, `${path}/cancel`, undefined, {})).status).toBe(401);
  const other = await pair(app);
  expect((await request(app, `${path}/cancel`, other.token, {})).status).toBe(404);
  const cancelled = await request(app, `${path}/cancel`, token, {});
  expect(cancelled.status).toBe(200);
  const outcome = await cancelled.json();
  expect(outcome).toMatchObject({ ...question, state: "cancelled", response: null, provisional: null });
  for (const [endpoint, body] of [
    [`${path}/cancel`, {}],
    [`${path}/response`, { value: "yes", choiceId: crypto.randomUUID() }],
    [`${path}/custom-response`, { text: "Too late" }],
    ["/api/questions", question],
  ] as const) {
    expect(await (await request(app, endpoint, token, body)).json()).toEqual(outcome);
  }
  expect(await (await request(app, "/api/inbox", token)).json()).toMatchObject({ questions: [] });
  expect((await request(app, "/api/questions", token, { ...question, wording: "Changed" })).status).toBe(409);
});

test("MCP cancellation releases an active wait with a committed outcome and survives reconnect and restart", async () => {
  const { Client, StreamableHTTPClientTransport } = await import("@modelcontextprotocol/client");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const directory = await mkdtemp("/tmp/slop-cancel-");
  const databasePath = `${directory}/inbox.sqlite`;
  let app = application({ databasePath });
  const { token } = await pair(app);
  async function call(name: string, args: Record<string, unknown>) {
    const target = app;
    const client = new Client({ name: "cancel-test", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
    await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      fetch: (url, init) => target.fetch(new Request(url.toString(), init)),
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }));
    try { return await client.callTool({ name, arguments: args }); }
    finally { await client.close(); }
  }
  try {
    await call("submit_question", question);
    const waiting = call("wait_for_response", { questionId: question.questionId, waitMs: 500 });
    await Bun.sleep(30);
    const cancellation = await call("cancel_question", { questionId: question.questionId });
    expect(cancellation.isError).not.toBe(true);
    expect(cancellation.structuredContent).toMatchObject({ state: "cancelled", response: null });
    expect(cancellation.structuredContent).not.toHaveProperty("provisional");
    expect((await waiting).structuredContent).toEqual(cancellation.structuredContent);
    await app.close();
    app = application({ databasePath });
    for (const [name, args] of [
      ["get_response", { questionId: question.questionId }],
      ["wait_for_response", { questionId: question.questionId, waitMs: 500 }],
      ["cancel_question", { questionId: question.questionId }],
      ["submit_question", question],
    ] as const) {
      expect((await call(name, args)).structuredContent).toEqual(cancellation.structuredContent);
    }
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test("cancellation wins an active Undo window and publishes after commit, but a due binary Response wins", () => {
  let now = 1000;
  const app = application({ clock: () => now });
  const inboxId = app.store.createInbox();
  app.store.submit(inboxId, question);
  const choiceId = crypto.randomUUID();
  app.store.respond(inboxId, question.questionId, "yes", choiceId);
  const observations: unknown[] = [];
  const unsubscribe = app.store.subscribe(inboxId, () => {
    observations.push(app.store.get(inboxId, question.questionId));
  });
  now = 3999;
  const cancelled = app.store.cancel(inboxId, question.questionId);
  expect(cancelled).toMatchObject({ state: "cancelled", response: null, provisional: null });
  expect(observations).toEqual([cancelled]);
  expect(app.store.cancel(inboxId, question.questionId)).toEqual(cancelled);
  expect(observations).toHaveLength(1);
  expect(app.store.undo(inboxId, question.questionId, choiceId)).toEqual(cancelled);
  now = 5000;
  app.store.reconcileDeadlines();
  expect(app.store.get(inboxId, question.questionId)).toEqual(cancelled);
  unsubscribe();

  const second = { ...question, questionId: "01993940-1000-7000-8000-000000000018" };
  app.store.submit(inboxId, second);
  app.store.respond(inboxId, second.questionId, "no", crypto.randomUUID());
  now = 8000;
  const final = app.store.cancel(inboxId, second.questionId);
  expect(final).toMatchObject({ state: "answered", provisional: null, response: { type: "binary", value: "no", committedAt: 8000 } });
  expect(app.store.cancel(inboxId, second.questionId)).toEqual(final);
});

test("two devices racing Custom Send and cancellation retain the first committed outcome", async () => {
  const app = application();
  const { token } = await pair(app);
  for (const cancelFirst of [true, false]) {
    const input = { ...question, questionId: Bun.randomUUIDv7() };
    await request(app, "/api/questions", token, input);
    const path = `/api/questions/${input.questionId}`;
    const commands = cancelFirst
      ? [[`${path}/cancel`, {}], [`${path}/custom-response`, { text: "Keep it, but rename it." }]]
      : [[`${path}/custom-response`, { text: "Keep it, but rename it." }], [`${path}/cancel`, {}]];
    const responses = await Promise.all(commands.map(([endpoint, body]) => request(app, endpoint as string, token, body)));
    const [first, second] = await Promise.all(responses.map(async (response) =>
      (await response.json()) as QuestionView));
    if (!first || !second) throw new Error("Both devices must return an outcome");
    expect(["cancelled", "answered"]).toContain(first.state);
    expect(first.response).toEqual(first.state === "cancelled"
      ? null
      : { type: "custom", text: "Keep it, but rename it.", committedAt: expect.any(Number) });
    expect(second).toEqual(first);
    expect(await (await request(app, `${path}/response`, token, { value: "yes", choiceId: crypto.randomUUID() })).json()).toEqual(first);
    expect(await (await request(app, `${path}/cancel`, token, {})).json()).toEqual(first);
  }
});

test("a committed Custom answer cannot be replaced by explicit cancellation", () => {
  const app = application();
  const inboxId = app.store.createInbox();
  app.store.submit(inboxId, question);
  const answered = app.store.respondCustom(inboxId, question.questionId, "Yes, but keep the old contract.");
  expect(answered).toMatchObject({ state: "answered", response: { type: "custom", text: "Yes, but keep the old contract." } });
  expect(app.store.cancel(inboxId, question.questionId)).toEqual(answered);
});
