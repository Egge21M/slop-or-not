import type { InboxSnapshot, QuestionView } from "@slop-or-not/shared";
import { afterEach, expect, test } from "bun:test";
import { createApplication } from "../src/app";

const applications: ReturnType<typeof createApplication>[] = [];
afterEach(async () => {
  for (const app of applications.splice(0)) await app.close();
});
const secret = "test-signing-secret-at-least-thirty-two-bytes";
function application(databasePath = ":memory:") {
  const app = createApplication({ databasePath, jwtSecret: secret });
  applications.push(app);
  return app;
}
function request(
  app: ReturnType<typeof application>,
  path: string,
  method = "GET",
  body?: unknown,
  token?: string,
) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}
test("a phone creates an Inbox and uses its shared credential to fetch it", async () => {
  const app = application();
  const created = await request(app, "/api/inboxes", "POST");
  expect(created.status).toBe(201);
  const { token, inboxId } = (await created.json()) as {
    token: string;
    inboxId: string;
  };
  expect((await request(app, "/api/inbox")).status).toBe(401);
  expect(
    await (await request(app, "/api/inbox", "GET", undefined, token)).json(),
  ).toEqual({ inboxId, questions: [] });
});
const question = {
  questionId: "01993940-1000-7000-8000-000000000001",
  wording: "Should I keep the synchronous store?",
  project: "slop-or-not",
  agentSession: "codex-foundation",
  supportingMarkdown: "A transaction keeps competing writes atomic.",
};
async function pair(app: ReturnType<typeof application>) {
  return (await request(app, "/api/inboxes", "POST")).json() as Promise<{
    token: string;
    inboxId: string;
  }>;
}
test("an agent submits a Question and retrieves the phone's first committed binary Response", async () => {
  const app = application();
  const { token } = await pair(app);
  const submitted = await request(
    app,
    "/api/questions",
    "POST",
    question,
    token,
  );
  expect(submitted.status).toBe(200);
  expect(((await submitted.json()) as QuestionView).state).toBe("pending");
  const snapshot = (await (
    await request(app, "/api/inbox", "GET", undefined, token)
  ).json()) as InboxSnapshot;
  expect(snapshot.questions).toHaveLength(1);
  expect(snapshot.questions[0]).toMatchObject(question);
  const answered = await (
    await request(
      app,
      `/api/questions/${question.questionId}/response`,
      "POST",
      { value: "yes" },
      token,
    )
  ).json();
  expect(answered).toMatchObject({
    state: "answered",
    response: { type: "binary", value: "yes" },
  });
  await request(
    app,
    `/api/questions/${question.questionId}/response`,
    "POST",
    { value: "no" },
    token,
  );
  expect(
    await (
      await request(
        app,
        `/api/questions/${question.questionId}`,
        "GET",
        undefined,
        token,
      )
    ).json(),
  ).toEqual(answered);
  expect(
    (
      (await (
        await request(app, "/api/inbox", "GET", undefined, token)
      ).json()) as InboxSnapshot
    ).questions,
  ).toEqual([]);
});
test("identical retry returns one immutable Question and changed original content conflicts", async () => {
  const app = application();
  const { token } = await pair(app);
  const original = await (
    await request(app, "/api/questions", "POST", question, token)
  ).json();
  expect(
    await (
      await request(app, "/api/questions", "POST", question, token)
    ).json(),
  ).toEqual(original);
  expect(
    (
      await request(
        app,
        "/api/questions",
        "POST",
        { ...question, wording: ` ${question.wording}` },
        token,
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await request(
        app,
        "/api/questions",
        "POST",
        { ...question, supportingMarkdown: "Changed reasoning" },
        token,
      )
    ).status,
  ).toBe(409);
  expect(
    (
      (await (
        await request(app, "/api/inbox", "GET", undefined, token)
      ).json()) as InboxSnapshot
    ).questions,
  ).toHaveLength(1);
});
test("browser requests reject an unexpected Origin and configured host before creating an Inbox", async () => {
  const app = createApplication({
    databasePath: ":memory:",
    jwtSecret: secret,
    publicOrigin: "https://slop.example",
  });
  applications.push(app);
  expect(
    (
      await app.fetch(
        new Request("https://slop.example/api/inboxes", {
          method: "POST",
          headers: { Origin: "https://other.example" },
        }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await app.fetch(
        new Request("https://other.example/api/inboxes", { method: "POST" }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await app.fetch(
        new Request("https://slop.example/api/inboxes", { method: "POST" }),
      )
    ).status,
  ).toBe(201);
});
test("invalid UUIDv7 and forged credentials fail while Inbox access stays isolated", async () => {
  const app = application();
  const first = await pair(app);
  const second = await pair(app);
  expect(
    (await request(app, "/api/inbox", "GET", undefined, "forged")).status,
  ).toBe(401);
  expect(
    (
      await request(
        app,
        "/api/questions",
        "POST",
        { ...question, questionId: crypto.randomUUID() },
        first.token,
      )
    ).status,
  ).toBe(400);
  await request(app, "/api/questions", "POST", question, first.token);
  expect(
    (
      await request(
        app,
        `/api/questions/${question.questionId}`,
        "GET",
        undefined,
        second.token,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await request(
        app,
        `/api/questions/${question.questionId}/response`,
        "POST",
        { value: "yes" },
        second.token,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      (await (
        await request(app, "/api/inbox", "GET", undefined, second.token)
      ).json()) as InboxSnapshot
    ).questions,
  ).toEqual([]);
  expect(
    (
      await request(
        app,
        "/api/questions",
        "POST",
        { ...question, wording: "Different Inbox Question?" },
        second.token,
      )
    ).status,
  ).toBe(200);
});
test("pending Questions and committed Responses survive restart with the same credential", async () => {
  const databasePath = `/tmp/slop-foundation-${crypto.randomUUID()}.sqlite`;
  const app = application(databasePath);
  const { token } = await pair(app);
  await request(app, "/api/questions", "POST", question, token);
  const secondQuestion = {
    ...question,
    questionId: "01993940-1000-7000-8000-000000000002",
  };
  await request(app, "/api/questions", "POST", secondQuestion, token);
  const answered = await (
    await request(
      app,
      `/api/questions/${question.questionId}/response`,
      "POST",
      { value: "no" },
      token,
    )
  ).json();
  applications.splice(applications.indexOf(app), 1);
  await app.close();
  const restarted = application(databasePath);
  expect(
    await (
      await request(
        restarted,
        `/api/questions/${question.questionId}`,
        "GET",
        undefined,
        token,
      )
    ).json(),
  ).toEqual(answered);
  expect(
    (
      (await (
        await request(restarted, "/api/inbox", "GET", undefined, token)
      ).json()) as InboxSnapshot
    ).questions,
  ).toMatchObject([{ ...secondQuestion, state: "pending" }]);
  expect(
    await (
      await request(restarted, "/api/questions", "POST", question, token)
    ).json(),
  ).toEqual(answered);
});
test("the authenticated phone stream announces authoritative changes and reconnect fetches current Inbox state", async () => {
  const app = application();
  const { token } = await pair(app);
  const abort = new AbortController();
  const stream = await app.fetch(
    new Request("http://localhost/api/events", {
      headers: { authorization: `Bearer ${token}` },
      signal: abort.signal,
    }),
  );
  expect(stream.headers.get("content-type")).toBe("text/event-stream");
  const reader = stream.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain(
    "event: changed",
  );
  await request(app, "/api/questions", "POST", question, token);
  expect(new TextDecoder().decode((await reader.read()).value)).toContain(
    "event: changed",
  );
  abort.abort();
  await reader.cancel();
  expect(
    (
      (await (
        await request(app, "/api/inbox", "GET", undefined, token)
      ).json()) as InboxSnapshot
    ).questions,
  ).toHaveLength(1);
  expect((await request(app, "/api/events")).status).toBe(401);
});
test("startup refuses a weak signing secret or a missing migration set", () => {
  expect(() =>
    createApplication({ databasePath: ":memory:", jwtSecret: "weak" }),
  ).toThrow("JWT_SECRET");
  expect(() =>
    createApplication({
      databasePath: ":memory:",
      jwtSecret: secret,
      migrationsPath: "/tmp/no-such-slop-migrations",
    }),
  ).toThrow();
});
test("a configured HTTPS origin accepts TLS-terminated HTTP on its expected host", async () => {
  const app = createApplication({
    databasePath: ":memory:",
    jwtSecret: secret,
    publicOrigin: "https://slop.example",
  });
  applications.push(app);
  expect(
    (
      await app.fetch(
        new Request("http://slop.example/api/inboxes", {
          method: "POST",
          headers: { Origin: "https://slop.example" },
        }),
      )
    ).status,
  ).toBe(201);
});
