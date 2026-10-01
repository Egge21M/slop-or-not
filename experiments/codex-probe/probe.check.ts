import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { test, expect } from "bun:test";
import { createProbe } from "./probe";
const token = "probe-test-only";
async function rpc(
  probe: ReturnType<typeof createProbe>,
  name: string,
  args: Record<string, unknown>,
) {
  const client = new Client(
    { name: "probe-test", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StreamableHTTPClientTransport(
    new URL("http://localhost/mcp"),
    {
      fetch: (url, init) => probe.fetch(new Request(url, init)),
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
test("a browser Response can be retrieved through independent authenticated MCP requests", async () => {
  const probe = createProbe({ token });
  try {
    const submitted = await rpc(probe, "submit_question", {
      questionId: "probe-first",
      wording: "Proceed?",
    });
    expect(submitted.structuredContent).toEqual({
      questionId: "probe-first",
      wording: "Proceed?",
      state: "pending",
    });
    const answer = await probe.fetch(
      new Request("http://localhost/answer", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ questionId: "probe-first", response: "yes" }),
      }),
    );
    expect(answer.status).toBe(200);
    const retrieved = await rpc(probe, "get_response", {
      questionId: "probe-first",
    });
    expect(retrieved.structuredContent).toEqual({
      questionId: "probe-first",
      wording: "Proceed?",
      state: "answered",
      response: "yes",
    });
  } finally {
    await probe.close();
  }
});

test("timeout and loss of the wait do not answer or withdraw the Question", async () => {
  const probe = createProbe({ token });
  const client = new Client(
    { name: "probe-test", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      fetch: (url, init) => probe.fetch(new Request(url, init)),
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  try {
    await client.callTool({
      name: "submit_question",
      arguments: { questionId: "timeout", wording: "Continue?" },
    });
    const bounded = await client.callTool({
      name: "wait_for_response",
      arguments: { questionId: "timeout", waitMs: 30 },
    });
    expect(bounded.structuredContent).toEqual({
      questionId: "timeout",
      wording: "Continue?",
      state: "pending",
    });
    await expect(
      client.callTool(
        {
          name: "wait_for_response",
          arguments: { questionId: "timeout", waitMs: 20000 },
        },
        { timeout: 40 },
      ),
    ).rejects.toThrow();
    await client.close();
    const state = await rpc(probe, "get_response", { questionId: "timeout" });
    expect(state.structuredContent).toEqual({
      questionId: "timeout",
      wording: "Continue?",
      state: "pending",
    });
  } finally {
    await client.close();
    await probe.close();
  }
});
