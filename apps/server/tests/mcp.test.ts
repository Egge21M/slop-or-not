import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { expect, test } from "bun:test";
import { createApplication } from "../src/app";

test("independent authenticated MCP requests submit and retrieve the phone's Response", async () => {
  const app = createApplication({
    databasePath: ":memory:",
    jwtSecret: "test-signing-secret-at-least-thirty-two-bytes",
  });
  const paired = await app.fetch(
    new Request("http://localhost/api/inboxes", { method: "POST" }),
  );
  const { token } = (await paired.json()) as { token: string };
  async function call(name: string, args: Record<string, unknown>) {
    const client = new Client(
      { name: "foundation-test", version: "1" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL("http://localhost/mcp"),
      {
        fetch: (url, init) => app.fetch(new Request(url.toString(), init)),
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      },
    );
    await client.connect(transport);
    try {
      return await client.callTool({ name, arguments: args });
    } finally {
      await client.close();
    }
  }
  try {
    const question = {
      questionId: "01993940-1000-7000-8000-000000000003",
      wording: "Should we proceed?",
      project: "foundation",
      agentSession: "mcp-test",
    };
    expect(
      (await call("submit_question", question)).structuredContent,
    ).toMatchObject({ ...question, state: "pending" });
    await app.fetch(
      new Request(
        `http://localhost/api/questions/${question.questionId}/response`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ value: "yes" }),
        },
      ),
    );
    expect(
      (await call("get_response", { questionId: question.questionId }))
        .structuredContent,
    ).toMatchObject({
      state: "answered",
      response: { type: "binary", value: "yes" },
    });
    expect(
      (await app.fetch(new Request("http://localhost/mcp", { method: "POST" })))
        .status,
    ).toBe(401);
  } finally {
    await app.close();
  }
});
