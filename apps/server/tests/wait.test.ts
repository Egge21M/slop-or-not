import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createApplication } from '../src/app';

const jwtSecret = 'wait-test-signing-secret-at-least-thirty-two-bytes';
const question = {
  questionId: '01993940-1000-7000-8000-000000000006',
  wording: 'Should we apply the migration?', project: 'wait-test', agentSession: 'original-agent',
};
async function fixture(databasePath = ':memory:') {
  const app = createApplication({ databasePath, jwtSecret });
  const { token } = await (await app.fetch(new Request('http://localhost/api/inboxes', { method: 'POST' }))).json() as { token: string };
  return { app, token };
}
async function call(app: ReturnType<typeof createApplication>, token: string, name: string, args: Record<string, unknown>, options: { timeout?: number; signal?: AbortSignal } = {}) {
  const client = new Client({ name: 'wait-test', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
    fetch: (url, init) => app.fetch(new Request(url.toString(), init)),
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  try { return await client.callTool({ name, arguments: args }, options); }
  finally { await client.close(); }
}
async function answer(app: ReturnType<typeof createApplication>, token: string) {
  return app.fetch(new Request(`http://localhost/api/questions/${question.questionId}/response`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ value: 'yes' }),
  }));
}

test('bounded MCP wait consumes a later committed phone Response across independent requests', async () => {
  const { app, token } = await fixture();
  try {
    expect((await call(app, token, 'submit_question', question)).structuredContent).toMatchObject({ state: 'pending', response: null });
    const waiting = call(app, token, 'wait_for_response', { questionId: question.questionId, waitMs: 1000 });
    await Bun.sleep(50);
    expect((await answer(app, token)).status).toBe(200);
    expect((await waiting).structuredContent).toMatchObject({ state: 'answered', response: { type: 'binary', value: 'yes' } });
    expect((await call(app, token, 'get_response', { questionId: question.questionId })).structuredContent).toMatchObject({ state: 'answered', response: { value: 'yes' } });
  } finally { await app.close(); }
});

test('wait deadline and client timeout preserve pending Questions for reissued observation', async () => {
  const { app, token } = await fixture();
  try {
    await call(app, token, 'submit_question', question);
    expect((await call(app, token, 'wait_for_response', { questionId: question.questionId, waitMs: 10 })).structuredContent).toMatchObject({ state: 'pending', response: null });
    await expect(call(app, token, 'wait_for_response', { questionId: question.questionId, waitMs: 1000 }, { timeout: 20 })).rejects.toThrow();
    expect((await call(app, token, 'get_response', { questionId: question.questionId })).structuredContent).toMatchObject({ state: 'pending', response: null });
    expect((await call(app, token, 'submit_question', question)).structuredContent).toMatchObject({ state: 'pending' });
    const inbox = await (await app.fetch(new Request('http://localhost/api/inbox', { headers: { authorization: `Bearer ${token}` } }))).json() as { questions: unknown[] };
    expect(inbox.questions).toHaveLength(1);
    await answer(app, token);
    expect((await call(app, token, 'wait_for_response', { questionId: question.questionId, waitMs: 0 })).structuredContent).toMatchObject({ state: 'answered', response: { value: 'yes' } });
  } finally { await app.close(); }
});

test('pending submission and committed Response survive server restarts with the same JWT and Question ID', async () => {
  const directory = await mkdtemp('/tmp/slop-wait-test-');
  const databasePath = `${directory}/inbox.sqlite`;
  let app: ReturnType<typeof createApplication> | undefined;
  try {
    const paired = await fixture(databasePath);
    app = paired.app;
    const { token } = paired;
    await call(app, token, 'submit_question', question);
    await app.close();
    app = createApplication({ databasePath, jwtSecret });
    expect((await call(app, token, 'get_response', { questionId: question.questionId })).structuredContent).toMatchObject({ ...question, state: 'pending', response: null });
    await answer(app, token);
    await app.close();
    app = createApplication({ databasePath, jwtSecret });
    const expected = { state: 'answered', response: { type: 'binary', value: 'yes' } };
    expect((await call(app, token, 'get_response', { questionId: question.questionId })).structuredContent).toMatchObject(expected);
    expect((await call(app, token, 'submit_question', question)).structuredContent).toMatchObject(expected);
    expect((await call(app, token, 'wait_for_response', { questionId: question.questionId, waitMs: 1000 })).structuredContent).toMatchObject(expected);
  } finally { await app?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('closing the store releases an active wait immediately with an unavailable outcome', async () => {
  const { app, token } = await fixture();
  try {
    await call(app, token, 'submit_question', question);
    const waiting = call(app, token, 'wait_for_response', { questionId: question.questionId, waitMs: 20000 });
    await Bun.sleep(50);
    app.store.close();
    expect(await waiting).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Server unavailable; reconnect with the original Question ID' }] });
  } finally { await app.close(); }
});

test('invalid wait bounds and interrupted observation cannot create or answer a Question', async () => {
  const { app, token } = await fixture();
  try {
    await call(app, token, 'submit_question', question);
    expect(await call(app, token, 'wait_for_response', { questionId: question.questionId, waitMs: 20001 })).toMatchObject({ isError: true });
    const controller = new AbortController();
    const waiting = call(app, token, 'wait_for_response', { questionId: question.questionId, waitMs: 1000 }, { signal: controller.signal });
    await Bun.sleep(50);
    controller.abort();
    await expect(waiting).rejects.toThrow();
    expect((await call(app, token, 'get_response', { questionId: question.questionId })).structuredContent).toMatchObject({ state: 'pending', response: null });
  } finally { await app.close(); }
});
