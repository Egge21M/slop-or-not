import {
  createMcpHandler,
  McpServer,
  ProtocolError,
} from "@modelcontextprotocol/server";
import { getResponseSchema, submitQuestionSchema } from "@slop-or-not/shared";
import { DomainError, type Store } from "./store";

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
      const output = (run: () => ReturnType<Store["get"]>) => {
        try {
          const question = run();
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(question) },
            ],
            structuredContent: { ...question },
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
        "prioritize_question",
        {
          description:
            "Promote a pending Question to priority without changing its original creation time. Oldest priority Questions come first. Repeated promotion has no further effect; a finished Question returns its existing outcome.",
          inputSchema: getResponseSchema,
          annotations: { idempotentHint: true, destructiveHint: false },
        },
        async ({ questionId }) => output(() => store.prioritize(inboxId, questionId)),
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
      return server;
    },
    { legacy: "stateless", responseMode: "sse", keepAliveMs: 1000 },
  );
}
