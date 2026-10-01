import { ZodError } from "zod";
import { serveWeb } from "./static";
import {
  binaryResponseSchema,
  questionIdSchema,
  submitQuestionSchema,
  undoBinarySchema,
} from "@slop-or-not/shared";
import { createStore, DomainError } from "./store";
import { createPhoneEvents } from "./events";
import { createMcp } from "./mcp";
import { createAuth } from "./auth";
export function createApplication(options: {
  databasePath: string;
  jwtSecret: string;
  clock?: () => number;
  migrationsPath?: string;
  publicOrigin?: string;
  webDirectory?: string;
}) {
  if (new TextEncoder().encode(options.jwtSecret).byteLength < 32)
    throw new Error("JWT_SECRET must contain at least 32 bytes");
  const store = createStore(options);
  const auth = createAuth(options.jwtSecret, store);
  const mcp = createMcp(store);
  const events = createPhoneEvents(store);
  return {
    store,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path === "/health" && request.method === "GET")
        return Response.json({ ok: true });
      const expected = options.publicOrigin
        ? new URL(options.publicOrigin)
        : url;
      if (
        url.host !== expected.host ||
        (request.headers.has("origin") &&
          request.headers.get("origin") !== expected.origin)
      )
        return Response.json({ error: "Origin rejected" }, { status: 403 });
      try {
        if (!path.startsWith("/api/") && path !== "/mcp")
          return serveWeb(
            request,
            options.webDirectory ??
              new URL("../../web/dist", import.meta.url).pathname,
          );
        if (path === "/api/inboxes" && request.method === "POST") {
          const inboxId = store.createInbox();
          return Response.json(
            { inboxId, token: await auth.sign(inboxId) },
            { status: 201 },
          );
        }
        const inboxId = await auth.authenticate(request);
        if (!inboxId)
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        if (path === "/api/events" && request.method === "GET")
          return events.stream(inboxId, request.signal);
        if (path === "/mcp")
          return mcp.fetch(request, {
            authInfo: {
              token: request.headers.get("authorization")!.slice(7),
              clientId: inboxId,
              scopes: [],
            },
          });
        if (path === "/api/inbox" && request.method === "GET")
          return Response.json(store.snapshot(inboxId));
        if (path === "/api/questions" && request.method === "POST")
          return Response.json(
            store.submit(
              inboxId,
              submitQuestionSchema.parse(await request.json()),
            ),
          );
        const match = path.match(/^\/api\/questions\/([^/]+)(\/response|\/undo)?$/);
        if (match) {
          const id = questionIdSchema.parse(match[1]);
          if (request.method === "GET" && !match[2])
            return Response.json(store.get(inboxId, id));
          if (request.method === "POST" && match[2] === "/undo") {
            const input = undoBinarySchema.parse(await request.json());
            return Response.json(store.undo(inboxId, id, input.choiceId));
          }
          if (request.method === "POST" && match[2] === "/response") {
            const input = binaryResponseSchema.parse(await request.json());
            return Response.json(
              store.respond(
                inboxId,
                id,
                input.value,
                input.choiceId,
              ),
            );
          }
        }
        return Response.json({ error: "Not found" }, { status: 404 });
      } catch (error) {
        if (error instanceof DomainError)
          return Response.json(
            { error: error.message },
            { status: error.status },
          );
        if (error instanceof ZodError || error instanceof SyntaxError)
          return Response.json({ error: "Invalid request" }, { status: 400 });
        return Response.json(
          { error: "Internal server error" },
          { status: 500 },
        );
      }
    },
    async close() {
      events.close();
      await mcp.close();
      store.close();
    },
  };
}
