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
async function request(app: ReturnType<typeof application>, path: string, token?: string, body?: unknown) {
  return app.fetch(new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}
const question = (suffix: string) => ({
  questionId: `01993940-1000-7000-8000-0000000000${suffix}`,
  wording: "Can I proceed?", project: "history", agentSession: "codex",
  supportingMarkdown: "Keep **compatibility**.",
});
async function pair(app: ReturnType<typeof application>) {
  return await (await request(app, "/api/inboxes", undefined, {})).json() as { token: string; inboxId: string };
}

test("read-only history includes only this Inbox's committed binary and Custom Responses with original metadata and timestamps", async () => {
  let now = 1000;
  const app = application(":memory:", () => now);
  const { token } = await pair(app);
  const binary = question("91"), custom = question("92"), cancelled = question("93");
  for (const q of [binary, custom, cancelled]) await request(app, "/api/questions", token, q);
  await request(app, `/api/questions/${binary.questionId}/response`, token, { value: "yes", choiceId: crypto.randomUUID() });
  await request(app, `/api/questions/${cancelled.questionId}/cancel`, token, {});
  expect(await (await request(app, "/api/history", token)).json()).toEqual({ questions: [] });
  now = 2000;
  await request(app, `/api/questions/${custom.questionId}/custom-response`, token, { text: "Yes, but keep compatibility.\nAsk before removal." });
  now = 4000;
  const history = await request(app, "/api/history", token);
  expect(history.status).toBe(200);
  expect(await history.json()).toMatchObject({ questions: [
    { ...binary, createdAt: 1000, state: "answered", response: { type: "binary", value: "yes", committedAt: 4000 }, provisional: null },
    { ...custom, createdAt: 1000, state: "answered", response: { type: "custom", text: "Yes, but keep compatibility.\nAsk before removal.", committedAt: 2000 }, provisional: null },
  ] });
  const other = await pair(app);
  expect(await (await request(app, "/api/history", other.token)).json()).toEqual({ questions: [] });
  expect((await request(app, "/api/history")).status).toBe(401);
  expect((await request(app, "/api/history", token, {})).status).toBe(404);
});

test("finished content expires at exactly seven days while pending Questions survive; identical retries stay expired and conflicts remain scoped", async () => {
  const week = 7 * 24 * 60 * 60 * 1000;
  let now = 1000;
  const app = application(":memory:", () => now);
  const { token } = await pair(app);
  const finished = question("91"), cancelled = question("93"), pending = question("94");
  for (const q of [finished, cancelled, pending]) await request(app, "/api/questions", token, q);
  await request(app, `/api/questions/${finished.questionId}/custom-response`, token, { text: "Yes, but keep it." });
  await request(app, `/api/questions/${cancelled.questionId}/cancel`, token, {});
  now = 1000 + week - 1;
  expect(await (await request(app, `/api/questions/${finished.questionId}`, token)).json()).toMatchObject({ state: "answered", wording: finished.wording });
  expect(await (await request(app, `/api/questions/${cancelled.questionId}`, token)).json()).toMatchObject({ state: "cancelled", wording: cancelled.wording });
  now += 1;
  for (const q of [finished, cancelled]) {
    const expired = { questionId: q.questionId, state: "expired" };
    expect(await (await request(app, `/api/questions/${q.questionId}`, token)).json()).toEqual(expired);
    expect(await (await request(app, "/api/questions", token, q)).json()).toEqual(expired);
    expect((await request(app, "/api/questions", token, { ...q, supportingMarkdown: "Changed content" })).status).toBe(409);
    for (const [action, body] of [["custom-response", { text: "stale text" }], ["response", { value: "no", choiceId: crypto.randomUUID() }], ["priority", {}], ["cancel", {}], ["undo", { choiceId: crypto.randomUUID() }]] as const) {
      expect(await (await request(app, `/api/questions/${q.questionId}/${action}`, token, body)).json()).toEqual(expired);
    }
  }
  expect(await (await request(app, "/api/history", token)).json()).toEqual({ questions: [] });
  expect(await (await request(app, "/api/inbox", token)).json()).toMatchObject({ questions: [{ ...pending, state: "pending" }] });
  const other = await pair(app);
  expect((await request(app, `/api/questions/${finished.questionId}`, other.token)).status).toBe(404);
  expect(await (await request(app, "/api/questions", other.token, finished)).json()).toMatchObject({ state: "pending" });
});


test("restarts preserve history and expire binary/custom/cancelled content without recreating Questions or clearing pending content", async () => {
  const databasePath = `/tmp/slop-history-${crypto.randomUUID()}.sqlite`;
  let now = 1000;
  let app = application(databasePath, () => now);
  try {
    const { token, inboxId } = await pair(app);
    const binary = question("91"), custom = question("92"), cancelled = question("93"), pending = question("94");
    for (const q of [binary, custom, cancelled, pending]) await request(app, "/api/questions", token, q);
    await request(app, `/api/questions/${custom.questionId}/custom-response`, token, { text: "Yes, with constraints." });
    await request(app, `/api/questions/${cancelled.questionId}/cancel`, token, {});
    await request(app, `/api/questions/${binary.questionId}/response`, token, { value: "no", choiceId: crypto.randomUUID() });
    await app.close();
    now = 4000;
    app = application(databasePath, () => now);
    expect(await (await request(app, "/api/history", token)).json()).toMatchObject({ questions: [
      { ...binary, response: { type: "binary", value: "no", committedAt: 4000 } },
      { ...custom, response: { type: "custom", text: "Yes, with constraints.", committedAt: 1000 } },
    ] });
    await app.close();
    now = 1000 + 7 * 24 * 60 * 60 * 1000;
    app = application(databasePath, () => now);
    expect(await (await request(app, "/api/history", token)).json()).toMatchObject({ questions: [{ ...binary }] });
    for (const q of [custom, cancelled]) {
      expect(await (await request(app, "/api/questions", token, q)).json()).toEqual({ questionId: q.questionId, state: "expired" });
      expect((await request(app, "/api/questions", token, { ...q, agentSession: "Another session" })).status).toBe(409);
    }
    await app.close();
    now = 4000 + 7 * 24 * 60 * 60 * 1000 - 1;
    app = application(databasePath, () => now);
    expect(await (await request(app, `/api/questions/${binary.questionId}`, token)).json()).toMatchObject({ state: "answered" });
    now += 1;
    // A scheduled expiry publishes authoritative history cleanup without a query.
    const notification = new Promise<void>((resolve) => app.store.subscribe(
      inboxId, () => resolve()));
    await Promise.race([notification, Bun.sleep(1000).then(() => { throw new Error("Expiry timer did not publish"); })]);
    expect(await (await request(app, `/api/questions/${binary.questionId}`, token)).json()).toEqual({ questionId: binary.questionId, state: "expired" });
    await app.close();
    app = application(databasePath, () => now);
    expect(await (await request(app, "/api/questions", token, binary)).json()).toEqual({ questionId: binary.questionId, state: "expired" });
    expect(await (await request(app, "/api/history", token)).json()).toEqual({ questions: [] });
    expect(await (await request(app, "/api/inbox", token)).json()).toMatchObject({ questions: [{ ...pending, state: "pending" }] });
  } finally {
    await app.close();
    const { rm } = await import("node:fs/promises");
    for (const suffix of ["", "-wal", "-shm"]) await rm(`${databasePath}${suffix}`, { force: true });
  }
});
