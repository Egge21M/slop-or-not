import {
  createMcpHandler,
  McpServer,
  ProtocolError,
} from "@modelcontextprotocol/server";
import { getResponseSchema, submitQuestionSchema, waitForResponseSchema, type QuestionView } from "@slop-or-not/shared";
import { DomainError, type Store } from "./store";
import { waitForResponse } from "./wait";

export function createMcp(store: Store) {
  return createMcpHandler(
    ({ authInfo }) => {
      const inboxId = authInfo?.clientId;
      if (!inboxId || !store.hasInbox(inboxId))
        throw new ProtocolError(-32602, "Inbox unavailable");
      const server = new McpServer(
        { name: "slop-or-not", version: "0.1.0" },
        { capabilities: { tools: {} } },
      );
      const output = async (run: () => QuestionView | Promise<QuestionView>) => {
        try {
          const question = await run();
          const outcome = { ...question };
          // The browser needs its acknowledged Undo choice; agents observe only
          // committed Responses. Keep pending choices out of MCP results.
          Reflect.deleteProperty(outcome, "provisional");
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(outcome) },
            ],
            structuredContent: outcome,
          };
        } catch (error) {
          if (error instanceof DomainError)
            return {
              content: [{ type: "text" as const, text: error.message }],
              isError: true,
            };
          throw error;
        }
      };
      server.registerTool(
        "submit_question",
        {
          description:
            "Submit an immutable yes/no Question using your chosen UUIDv7. Identical retries return its current state; changed content conflicts. Returns immediately so you can continue independent work.",
          inputSchema: submitQuestionSchema,
        },
        async (input) => output(() => store.submit(inboxId, input)),
      );
      server.registerTool(
        "get_response",
        {
          description:
            "Retrieve the authoritative Question outcome by its original ID, including after reconnect. A pending Question has no delivered Response.",
          inputSchema: getResponseSchema,
          annotations: { readOnlyHint: true },
        },
        async ({ questionId }) => output(() => store.get(inboxId, questionId)),
      );
      server.registerTool(
        "wait_for_response",
        {
          description:
            "Wait up to waitMs (default 10000, maximum 20000) for the authoritative outcome. The deadline returns pending if unanswered. A disconnect or timeout never answers or cancels the Question; retrieve or wait again with the original ID. Provisional human choices are not delivered Responses.",
          inputSchema: waitForResponseSchema,
          annotations: { readOnlyHint: true },
        },
        async ({ questionId, waitMs }, ctx) => output(() =>
          waitForResponse(store, inboxId, questionId, waitMs, ctx.mcpReq.signal)),
      );
      return server;
    },
    { legacy: "stateless", responseMode: "sse", keepAliveMs: 1000 },
  );
}
