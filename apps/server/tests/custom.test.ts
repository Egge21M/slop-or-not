import { afterEach, expect, test } from "bun:test";
import { createApplication } from "../src/app";

const apps: ReturnType<typeof createApplication>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
function application() {
  const app = createApplication({
    databasePath: ":memory:",
    jwtSecret: "test-signing-secret-at-least-thirty-two-bytes",
  });
  apps.push(app);
  return app;
}
async function request(
  app: ReturnType<typeof application>,
  path: string,
  token?: string,
  body?: unknown,
) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}
const question = {
  questionId: "01993940-1000-7000-8000-000000000051",
  wording: "Can I proceed?",
  project: "custom",
  agentSession: "codex",
};
test("Custom answer Send preserves conditional text as a distinct final outcome and retries cannot replace it", async () => {
  const app = application();
  const { token } = (await (
    await request(app, "/api/inboxes", undefined, {})
  ).json()) as { token: string };
  await request(app, "/api/questions", token, question);
  const text =
    "  Yes, but keep the old endpoint.\nAsk me before deleting it.  ";
  const sent = await request(
    app,
    `/api/questions/${question.questionId}/custom-response`,
    token,
    { text },
  );
  expect(sent.status).toBe(200);
  const final = await sent.json();
  expect(final).toMatchObject({
    state: "answered",
    response: { type: "custom", text, committedAt: expect.any(Number) },
  });
  expect(
    await (
      await request(app, `/api/questions/${question.questionId}`, token)
    ).json(),
  ).toEqual(final);
  expect(
    await (
      await request(
        app,
        `/api/questions/${question.questionId}/custom-response`,
        token,
        { text: "Replacement" },
      )
    ).json(),
  ).toEqual(final);
  expect(
    await (
      await request(
        app,
        `/api/questions/${question.questionId}/response`,
        token,
        { value: "no" },
      )
    ).json(),
  ).toEqual(final);
  expect(
    await (await request(app, "/api/questions", token, question)).json(),
  ).toEqual(final);
});

test("an empty or whitespace-only Custom answer is rejected and the Question stays pending", async () => {
  const app = application();
  const { token } = (await (
    await request(app, "/api/inboxes", undefined, {})
  ).json()) as { token: string };
  await request(app, "/api/questions", token, question);
  for (const text of ["", " \n\t "]) {
    expect(
      (
        await request(
          app,
          `/api/questions/${question.questionId}/custom-response`,
          token,
          { text },
        )
      ).status,
    ).toBe(400);
  }
  expect(
    await (
      await request(app, `/api/questions/${question.questionId}`, token)
    ).json(),
  ).toMatchObject({ state: "pending", response: null });
});
