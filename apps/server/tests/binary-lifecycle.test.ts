import { afterEach, expect, test } from "bun:test";
import type { QuestionView } from "@slop-or-not/shared";
import { createApplication } from "../src/app";
const apps: ReturnType<typeof createApplication>[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
const secret = "binary-lifecycle-test-secret-at-least-32-bytes";
const question = { questionId: "01993940-1000-7000-8000-000000000014", wording: "Proceed?", project: "undo", agentSession: "lifecycle" };
const choiceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function app(clock: () => number, databasePath = ":memory:") {
  const value = createApplication({ databasePath, jwtSecret: secret, clock });
  apps.push(value);
  return value;
}
async function request(application: ReturnType<typeof app>, token: string, path: string, body?: unknown) {
  return application.fetch(new Request(`http://localhost${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));
}
async function pair(application: ReturnType<typeof app>) {
  const { token, inboxId } = await (await application.fetch(new Request("http://localhost/api/inboxes", { method: "POST" }))).json() as { token: string; inboxId: string };
  await request(application, token, "/api/questions", question);
  return { token, inboxId };
}
test("an acknowledged choice stays provisional until its stored three-second deadline", async () => {
  let now = 10_000;
  const application = app(() => now);
  const { token } = await pair(application);
  const selected = await (await request(application, token, `/api/questions/${question.questionId}/response`, { value: "yes", choiceId })).json();
  expect(selected).toMatchObject({ state: "pending", response: null, provisional: { choiceId, value: "yes", acknowledgedAt: 10_000, deadline: 13_000 } });
  now = 12_999;
  expect(await (await request(application, token, `/api/questions/${question.questionId}`)).json()).toMatchObject({ state: "pending", response: null });
  now = 13_000;
  expect(await (await request(application, token, `/api/questions/${question.questionId}`)).json()).toMatchObject({ state: "answered", response: { type: "binary", value: "yes", committedAt: 13_000 }, provisional: null });
});
test("Undo withdraws only its choice and replaying an acknowledged request cannot reset or recreate it", async () => {
  let now = 20_000;
  const application = app(() => now);
  const { token } = await pair(application);
  const path = `/api/questions/${question.questionId}`;
  const selected = await (await request(application, token, `${path}/response`, { value: "no", choiceId })).json();
  now = 21_000;
  expect(await (await request(application, token, `${path}/response`, { value: "no", choiceId })).json()).toEqual(selected);
  expect(await (await request(application, token, `${path}/undo`, { choiceId: crypto.randomUUID() })).json()).toEqual(selected);
  const undone = await (await request(application, token, `${path}/undo`, { choiceId })).json();
  expect(undone).toMatchObject({ state: "pending", response: null, provisional: null });
  expect(await (await request(application, token, `${path}/undo`, { choiceId })).json()).toEqual(undone);
  expect(await (await request(application, token, `${path}/response`, { value: "no", choiceId })).json()).toEqual(undone);
  now = 24_000;
  expect(await (await request(application, token, path)).json()).toEqual(undone);
  expect(await (await request(application, token, `${path}/response`, { value: "yes", choiceId: crypto.randomUUID() })).json()).toMatchObject({ provisional: { value: "yes", acknowledgedAt: 24_000, deadline: 27_000 } });
});
test("restart preserves an active deadline and startup finalizes overdue choices without another phone action", async () => {
  let now = 30_000;
  const databasePath = `/tmp/slop-binary-${crypto.randomUUID()}.sqlite`;
  let application = app(() => now, databasePath);
  const { token } = await pair(application);
  const path = `/api/questions/${question.questionId}`;
  const selected = await (await request(application, token, `${path}/response`, { value: "yes", choiceId })).json();
  apps.splice(apps.indexOf(application), 1);
  await application.close();
  now = 31_000;
  application = app(() => now, databasePath);
  expect(await (await request(application, token, path)).json()).toEqual(selected);
  apps.splice(apps.indexOf(application), 1);
  await application.close();
  now = 34_000;
  application = app(() => now, databasePath);
  const final = await (await request(application, token, path)).json();
  expect(final).toMatchObject({ state: "answered", response: { type: "binary", value: "yes", committedAt: 34_000 }, provisional: null });
  expect(await (await request(application, token, `${path}/undo`, { choiceId })).json()).toEqual(final);
});
test("at the deadline finalization wins over Undo and stale devices receive the first authoritative choice", async () => {
  let now = 40_000;
  const application = app(() => now);
  const { token } = await pair(application);
  const path = `/api/questions/${question.questionId}`;
  const results = await Promise.all([
    request(application, token, `${path}/response`, { value: "yes", choiceId }),
    request(application, token, `${path}/response`, { value: "no", choiceId: crypto.randomUUID() }),
  ]);
  const views = await Promise.all(results.map((response) => response.json()));
  expect(views[0]).toEqual(views[1]);
  const selected = (views[0] as QuestionView).provisional!;
  expect(["yes", "no"]).toContain(selected.value);
  expect(selected.deadline).toBe(43_000);
  now = 43_000;
  const [undone, competing] = await Promise.all([
    request(application, token, `${path}/undo`, { choiceId: selected.choiceId }),
    request(application, token, `${path}/response`, { value: selected.value === "yes" ? "no" : "yes", choiceId: crypto.randomUUID() }),
  ]);
  const outcome = await undone.json();
  expect(outcome).toMatchObject({ state: "answered", response: { value: selected.value, committedAt: 43_000 } });
  expect(await competing.json()).toEqual(outcome);
});
test("the server commits after the phone closes and subscribers can retrieve committed state when notified", async () => {
  const application = app(Date.now);
  const { token, inboxId } = await pair(application);
  const abort = new AbortController();
  const phone = await application.fetch(new Request("http://localhost/api/events", { headers: { authorization: `Bearer ${token}` }, signal: abort.signal }));
  const reader = phone.body!.getReader();
  await reader.read();
  const delivered = new Promise<unknown>((resolve) => {
    application.store.subscribe(inboxId, () => {
      const current = application.store.get(inboxId, question.questionId);
      if (current.state === "answered" && current.response) resolve(current);
    });
  });
  await request(application, token, `/api/questions/${question.questionId}/response`, { value: "no", choiceId });
  await reader.read();
  abort.abort();
  await reader.cancel();
  expect(await delivered).toMatchObject({ state: "answered", response: { type: "binary", value: "no" }, provisional: null });
});
