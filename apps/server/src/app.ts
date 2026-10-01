import { ZodError } from "zod";
import { serveWeb } from "./static";
import {
  binaryResponseSchema,
  customResponseSchema,
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
  const clock = options.clock ?? Date.now;
  const json = (body: unknown, init: ResponseInit = {}) => {
    const response = Response.json(body, init);
    response.headers.set("x-slop-server-time", String(clock()));
    return response;
  };
  return {
    store,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path === "/health" && request.method === "GET")
        return json({ ok: true });
      const expected = options.publicOrigin
        ? new URL(options.publicOrigin)
        : url;
      if (
        url.host !== expected.host ||
        (request.headers.has("origin") &&
          request.headers.get("origin") !== expected.origin)
      )
        return json({ error: "Origin rejected" }, { status: 403 });
      try {
        if (!path.startsWith("/api/") && path !== "/mcp")
          return serveWeb(
            request,
            options.webDirectory ??
              new URL("../../web/dist", import.meta.url).pathname,
          );
        if (path === "/api/inboxes" && request.method === "POST") {
          const inboxId = store.createInbox();
          return json(
            { inboxId, token: await auth.sign(inboxId) },
            { status: 201 },
          );
        }
        const inboxId = await auth.authenticate(request);
        if (!inboxId)
          return json({ error: "Unauthorized" }, { status: 401 });
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
          return json(store.snapshot(inboxId));
        if (path === "/api/inbox" && request.method === "DELETE")
          return json(store.deleteInbox(inboxId));
        if (path === "/api/history" && request.method === "GET")
          return json(store.history(inboxId));
        if (path === "/api/questions" && request.method === "POST")
          return json(
            store.submit(
              inboxId,
              submitQuestionSchema.parse(await request.json()),
            ),
          );
        const match = path.match(
          /^\/api\/questions\/([^/]+)(\/response|\/custom-response|\/undo|\/priority|\/cancel)?$/,
        );

        if (match) {
          const id = questionIdSchema.parse(match[1]);
          if (request.method === "GET" && !match[2])
            return json(store.get(inboxId, id));
          if (request.method === "POST" && match[2] === "/cancel")
            return json(store.cancel(inboxId, id));
          if (request.method === "POST" && match[2] === "/custom-response")
            return json(
              store.respondCustom(
                inboxId,
                id,
                customResponseSchema.parse(await request.json()).text,
              ),
            );
          if (request.method === "POST" && match[2] === "/priority")
            return json(store.prioritize(inboxId, id));

          if (request.method === "POST" && match[2] === "/undo") {
            const input = undoBinarySchema.parse(await request.json());
            return json(store.undo(inboxId, id, input.choiceId));
          }
          if (request.method === "POST" && match[2] === "/response") {
            const input = binaryResponseSchema.parse(await request.json());
            return json(
              store.respond(inboxId, id, input.value, input.choiceId),
            );
          }
        }
        return json({ error: "Not found" }, { status: 404 });
      } catch (error) {
        if (error instanceof DomainError)
          return json(
            { error: error.message },
            { status: error.status },
          );
        if (error instanceof ZodError || error instanceof SyntaxError)
          return json({ error: "Invalid request" }, { status: 400 });
        return json(
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
