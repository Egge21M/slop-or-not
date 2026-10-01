# MCP delivery of Responses from a phone

Research date: 2026-10-01. Scope: delivery of a Response from Slop or Not's separate phone UI to a coding agent, including waiting and continuing independent work. This records protocol facts and candidate approaches; it does not select an architecture. No live compatibility test or app implementation was performed.

## Findings that change the scope discussion

MCP can carry asynchronous updates. The current protocol retains long-lived event streams, and ChatGPT documents an event integration that can trigger a response. Neither fact establishes that an ordinary MCP server can wake any coding agent. Delivery to a client and scheduling another model turn are separate concerns.

The official `latest` specification resolves to **2026-07-28**. It is a published revision, not merely the draft. The official release announcement reports support in the TypeScript, Python, Go, and C# SDKs. Installed hosts and older SDK versions may implement an earlier revision. [Latest specification](https://modelcontextprotocol.io/specification/latest), [Release announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28/)

## Verified protocol facts

### HTTP and streams

Modern Streamable HTTP uses POST requests to one endpoint. A response may be JSON or a request-scoped SSE stream. Progress and logging notifications on that stream belong to the originating request; independent server requests cannot be sent there. Long-lived change notifications instead use the SSE response to a **POST `subscriptions/listen`** request. The removed mechanism is the previous standalone GET stream, together with protocol sessions and `Last-Event-ID` resumability. Keep-alive SSE comments help prevent idle intermediary timeouts; they are not application events. [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)

Subscriptions require explicit filters. The first notification acknowledges the supported subset; clients must not assume every requested type was accepted. Core filters cover tool, prompt, and resource list changes and specific resource URIs. A subscription ends on cancellation, server shutdown, or transport loss. A client must open a new subscription after loss; the stream is not a durable inbox. [Subscriptions](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions)

`notifications/tools/list_changed` announces a changed tool catalog, not a new result for an earlier tool call. A resource update identifies a changed URI; `resources/read` retrieves its content. Resources are application-driven: the host chooses how to incorporate them into model context. Consequently, a resource notification does not by itself promise an immediate model turn. [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), [Resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources)

### Waiting, disconnection, and Question lifetime

For an ordinary modern HTTP request, closing the SSE response stream means cancellation of that request. Implementations should establish configurable timeouts and enforce a maximum even if progress arrives. This rules out treating an indefinitely open call as universally reliable. [Cancellation](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation)

The TypeScript SDK defaults ordinary requests to 60 seconds; resetting on progress is opt-in. An optional total timeout covers the whole automatically fulfilled multi-round flow. These are SDK settings, not a guarantee about any particular host's timeout. [SDK request options](https://ts.sdk.modelcontextprotocol.io/v2/api/index/@modelcontextprotocol/client/)

**Product inference:** cancelling a transport wait need not withdraw the durable Question. Its lifetime can remain separate from any one connection. This is consistent with the current glossary's explicit Cancelled question, but requires application behavior; MCP does not define Slop or Not's Question lifecycle.

### Human input and MRTR

Modern Multi Round-Trip Requests (MRTR) return `resultType: "input_required"` rather than sending an independent server request. The client gathers inputs and retries the original method with a new JSON-RPC ID, keyed `inputResponses`, and any opaque `requestState` echoed unchanged. This is available for tools, resource reads, and prompts. Requested inputs require declared client capabilities. Servers must not assume the client will retry. State-only responses can permit immediate retries; that does not guarantee background scheduling or eventual delivery. [MRTR](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr)

Form elicitation gathers structured answers through the MCP client; the protocol leaves presentation to that client. URL elicitation directs the user to an external interaction. A URL `accept` means consent, **not completion**; a later retry lets the server check external state. Clients should offer manual retry/cancel controls. Elicitation modes are optional, must be declared, and require decline/cancel handling. Form mode cannot request tokens or other credentials; URL mode must not expose credentials or pre-authenticated protected links. URL mode is primarily specified for sensitive interactions and third-party authorization, so it is not established as a turnkey generic swipe-inbox mechanism. [Elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation)

**Product inference:** the already paired phone can write a Response to application state. A subsequent tool call can retrieve it without form elicitation. Using URL elicitation to point at the phone flow would still require supported client behavior and a completion/retry mechanism; opening a link does not deliver the answer back automatically.

### Durable Tasks

The optional Tasks extension permits asynchronous tool calls with durably retrievable handles. Client support is declared per request. `tasks/get` retrieves status, input requests, or final results. Task input uses `tasks/update`, not original-call retries; modern Tasks has no `tasks/result` or `tasks/list`. **`notifications/tasks` can push the full completed result**, through `subscriptions/listen(taskIds)`, not merely announce a status change. Polling remains available. Retention is server-controlled; cancellation is cooperative; operations require capability declaration and authorization. [Tasks specification](https://tasks.extensions.modelcontextprotocol.io/specification/2026-07-28/tasks)

The extension SDK documents saving a reference with `handoff()` before detaching and `resumeTask()` after reconnect or in another process. Endpoint identity and authentication context must remain consistent. Detach keeps remote work running; cancel requests its termination; stopping local observation alone stops waiting. These APIs distinguish durable execution from an agent's local wait. [Input and recovery](https://tasks.extensions.modelcontextprotocol.io/typescript/client/input-and-recovery), [Execution lifecycle](https://tasks.extensions.modelcontextprotocol.io/typescript/client/execution)

The extension has its own SDK package, `@modelcontextprotocol/ext-tasks`. Its documented receiver entry point is specifically for 2025-11-25; generation-specific schemas are separate. Base TypeScript SDK v2 does not automatically provide the former experimental Tasks interception layer. Supporting the new base revision therefore does not establish working Tasks support. [Adapters and schemas](https://tasks.extensions.modelcontextprotocol.io/typescript/adapters-and-schemas), [SDK migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28)

**Product inference:** an application-held Question could complete a Task when the phone supplies its Response, without emitting task `inputRequests`.

### Domain events and actually waking an agent

The MCP organization's **draft Events design sketch** proposes poll, POST SSE push, and webhook delivery of domain occurrences. Events have identifiers for deduplication and optional cursors; replay and reliability depend on the source. Push closes with its stream; webhooks need a reachable receiver and subscription lifetime management. The draft explicitly leaves event-to-tool wiring and deciding whether to invoke reasoning to the client. It contains unresolved questions and should not be treated as core or universal behavior. [Draft Events proposal](https://github.com/modelcontextprotocol/experimental-ext-triggers-events/blob/main/docs/design-sketch-proposal.md)

OpenAI documents a concrete **ChatGPT** integration: users select what to monitor and how to respond, ChatGPT subscribes with a callback, and a delivered event enters the subscribed chat where ChatGPT follows those instructions. It requires 2026-07-28 and supports verified webhooks; polling, streaming, and draft gap/termination controls are unsupported there. This is evidence of host-managed asynchronous reaction, not evidence about Codex CLI. [ChatGPT MCP Events](https://developers.openai.com/plugins/build/mcp-events)

## Codex: known and unverified

Codex's MCP documentation confirms Streamable HTTP, bearer tokens through `bearer_token_env_var`, and configurable `tool_timeout_sec` with a 60-second default. It does not document a guaranteed Tasks, MRTR, Events, or latest-revision compatibility contract. The locally installed executable reports `codex-cli 0.159.3`; no remote-server behavior was tested. [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

Codex app-server explicitly documents `mcpServer/elicitation/request` for form and URL requests, with accept/decline/cancel responses, and `serverRequest/resolved`. It also exposes turn start and steering APIs. This establishes an integration surface for a custom host; it does not prove that a phone Response can wake an existing ordinary CLI session through a generic MCP notification. [Codex app-server](https://learn.chatgpt.com/docs/app-server)

## Candidate approaches, not decisions

| Approach | Agent waits | Agent continues independent work | Main unresolved constraint |
| --- | --- | --- | --- |
| Ordinary submit/read tools with an explicit Question ID | Bounded wait or repeated reads | Return pending ID, check later | Host/agent must choose when to check; no automatic wake promise |
| Tasks extension | Local SDK can await completion | Detach and observe or recover later | Intended host must support extension and schedule result consumption |
| Resource subscriptions | Optional notification-assisted retrieval | Host can watch while other work proceeds | Host decides whether updates enter context or trigger a turn |
| MRTR/URL elicitation | Suspend the interaction until retry | Concurrent work is host-specific | Optional elicitation support; URL consent is not the answer |
| Events integration | No held tool call required | Host receives event and schedules reaction | ChatGPT webhook support verified; Codex CLI support unverified |
| Custom Codex app-server host | Host controls pending input | Host can steer/start turns after Response | Adds a host integration beyond a standalone MCP server |

This table is an inference from the facts above. **Tasks plus SSE result delivery is the strongest native candidate to investigate first if Codex capability can be proven.** Ordinary tools with durable Question IDs provide a fallback for waiting or continuing and checking later. Events or a custom host offer paths to asynchronous reaction. No delivery option alone establishes how Codex schedules work after receiving the Response. A targeted compatibility probe should precede selecting the transport or promising automatic resumption.
