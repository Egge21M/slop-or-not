# Priority queues and pending selection

Ticket #7 was checked on 2026-10-01 with Bun 1.3.14 and Chrome for Testing Stable 154.0.8037.92 at a 390 × 844 touch viewport.

`bun test apps/server/tests/priority.test.ts` verifies ordering through the public Store, HTTP and modern MCP interfaces. The Store clock demonstrates that promotion preserves creation timestamps and that SQLite restores the order after reopening. Authenticated HTTP promotion is scoped to an Inbox and emits an SSE change; an identical promotion or Question submission returns the same authoritative record. Independent MCP requests use `prioritize_question` and `get_response`.

The focused Chrome harness uses the production Vite assets and real Bun HTTP/SSE on loopback. It was run with `bun /tmp/slop-browser-tools/priority-smoke.ts`. Browser prerequisites are recorded in `/tmp/slop-smoke-notes.md`; the temporary harness and screenshot `/tmp/slop-priority-phone.png` are session evidence, not repository dependencies.

To repeat the browser scenario against a running app:

1. Create an Inbox. Submit three Questions in order from interleaved Agent sessions, each with distinct project/session identities. The first normal Question opens.
2. Promote the newest, then the middle Question using `prioritize_question` or authenticated `POST /api/questions/:id/priority`. Repeat the middle promotion. The pending list orders the middle, newest, then oldest normal Question. The oldest normal card remains open.
3. Select the newest Question in the pending list. Check all three records remain pending with no Response, and check the chosen card's identity and wording.
4. Disconnect the phone SSE stream while leaving the authoritative server available. Submit a fourth Question and promote the oldest Question. Reconnect. The selected newest card remains open; the list contains exactly four Questions in authoritative priority/creation order.
5. Reload. The next card is the oldest priority Question. The pending list still contains exactly four Questions, with project and Agent session identities.

All steps passed. Chrome reported no page errors. The test deliberately closed the server-side phone event stream and temporarily rejected reconnects, then restored it, instead of relying on a browser offline toggle that left an existing localhost stream open. This establishes local browser reconciliation behavior; hosted HTTPS proxy behavior remains part of the release smoke gate.
