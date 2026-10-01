import {
  createMcpHandler,
  McpServer,
  ProtocolError,
} from "@modelcontextprotocol/server";
import { z } from "zod";

export type Question = {
  questionId: string;
  wording: string;
  state: "pending" | "answered";
  response?: "yes" | "no";
};
export type Trace = {
  method?: string;
  protocolHeader?: string | null;
  meta?: unknown;
  initialize?: unknown;
  status?: number;
  contentType?: string | null;
  era?: string;
  tool?: string;
  phase?: string;
  questionId?: string;
  timestamp?: number;
};

// Experiment state deliberately belongs to the app, outside SDK per-request factories.
// Production replaces this Map with persistent Inbox-scoped records.
export function createProbe(options: {
  token: string;
  legacy?: boolean;
  trace?: (event: Trace) => void;
}) {
  const questions = new Map<string, Question>();
  const output = (question: Question) => ({
    content: [{ type: "text" as const, text: JSON.stringify(question) }],
    structuredContent: { ...question },
  });
  const lookup = (questionId: string) => {
    const question = questions.get(questionId);
    if (!question) throw new ProtocolError(-32602, "Unknown Question");
    return question;
  };
  const handler = createMcpHandler(
    ({ era }) => {
      options.trace?.({ era });
      const server = new McpServer(
        { name: "slop-codex-probe", version: "0.1.0" },
        { capabilities: { tools: {} } },
      );
      server.registerTool(
        "submit_question",
        {
          description:
            "Submit a yes/no Question to the separate browser. Return pending immediately so you can continue independent work.",
          inputSchema: z.object({
            questionId: z.string().min(1),
            wording: z.string().min(1),
          }),
        },
        async ({ questionId, wording }) => {
          const prior = questions.get(questionId);
          if (prior && prior.wording !== wording)
            throw new ProtocolError(-32602, "Question content conflict");
          const question = prior ?? {
            questionId,
            wording,
            state: "pending" as const,
          };
          questions.set(questionId, question);
          return output(question);
        },
      );
      server.registerTool(
        "get_response",
        {
          annotations: { readOnlyHint: true },
          description:
            "Retrieve current Question state after continuing independent work or reconnecting.",
          inputSchema: z.object({ questionId: z.string() }),
        },
        async ({ questionId }) => output(lookup(questionId)),
      );
      server.registerTool(
        "wait_for_response",
        {
          annotations: { readOnlyHint: true },
          description:
            "Wait at most waitMs (maximum 20000) for the separate browser. Timeout returns pending and does not cancel or answer the Question.",
          inputSchema: z.object({
            questionId: z.string(),
            waitMs: z.number().int().min(0).max(20000).default(10000),
          }),
        },
        async ({ questionId, waitMs }, ctx) => {
          const question = lookup(questionId);
          const deadline = Date.now() + waitMs;
          options.trace?.({
            phase: "wait-started",
            questionId,
            timestamp: Date.now(),
          });
          const onAbort = () =>
            options.trace?.({
              phase: "wait-aborted",
              questionId,
              timestamp: Date.now(),
            });
          ctx.mcpReq.signal.addEventListener("abort", onAbort, { once: true });
          try {
            while (
              question.state === "pending" &&
              Date.now() < deadline &&
              !ctx.mcpReq.signal.aborted
            )
              await Bun.sleep(Math.min(25, deadline - Date.now()));
            return output(question);
          } finally {
            ctx.mcpReq.signal.removeEventListener("abort", onAbort);
          }
        },
      );
      return server;
    },
    {
      legacy: options.legacy ? "stateless" : "reject",
      responseMode: "sse",
      keepAliveMs: 1000,
    },
  );
  return {
    close: handler.close,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === "/" && request.method === "GET")
        return new Response(
          Bun.file(new URL("./answer.html", import.meta.url)),
          { headers: { "Content-Type": "text/html" } },
        );
      if (request.headers.get("Authorization") !== `Bearer ${options.token}`)
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      if (
        request.headers.get("Origin") &&
        request.headers.get("Origin") !== url.origin
      )
        return Response.json({ error: "Origin rejected" }, { status: 403 });
      if (url.pathname === "/questions" && request.method === "GET")
        return Response.json([...questions.values()]);
      if (url.pathname === "/answer" && request.method === "POST") {
        const parsed = z
          .object({ questionId: z.string(), response: z.enum(["yes", "no"]) })
          .safeParse(await request.json());
        if (!parsed.success)
          return Response.json({ error: "Invalid answer" }, { status: 400 });
        const question = questions.get(parsed.data.questionId);
        if (!question)
          return Response.json({ error: "Unknown Question" }, { status: 404 });
        if (question.state === "pending") {
          question.state = "answered";
          question.response = parsed.data.response;
        }
        return Response.json(question);
      }
      if (url.pathname === "/mcp") {
        if (request.method === "POST") {
          const data = (await request.clone().json()) as {
            method?: string;
            params?: {
              _meta?: unknown;
              protocolVersion?: string;
              name?: string;
              clientInfo?: unknown;
              capabilities?: unknown;
            };
          };
          options.trace?.({
            method: data.method,
            tool: data.params?.name,
            timestamp: Date.now(),
            protocolHeader: request.headers.get("MCP-Protocol-Version"),
            meta: data.params?._meta
              ? {
                  protocolVersion: (
                    data.params._meta as Record<string, unknown>
                  )["io.modelcontextprotocol/protocolVersion"],
                  progressToken: (data.params._meta as Record<string, unknown>)
                    .progressToken,
                }
              : undefined,
            initialize:
              data.method === "initialize"
                ? {
                    protocolVersion: data.params?.protocolVersion,
                    clientInfo: data.params?.clientInfo,
                    capabilities: data.params?.capabilities,
                  }
                : undefined,
          });
        }
        const response = await handler.fetch(request);
        options.trace?.({
          status: response.status,
          contentType: response.headers.get("Content-Type"),
        });
        return response;
      }
      return new Response("Not found", { status: 404 });
    },
  };
}
