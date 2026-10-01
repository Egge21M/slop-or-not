# Phone and Codex pilot guide

Use current stable Chrome and the private HTTPS URL supplied by the operator. The app is a regular mobile web page. Keep it open to receive live Questions: background notifications and offline answering are outside this version. Keep the URL private; anyone who discovers it can create an Inbox.

## Pair and save access

1. On your phone, select **Create Inbox**. It creates a pseudonymous Inbox and saves its shared credential in this browser's localStorage.
2. Expand **Pair agents & save credential**. Copy the MCP endpoint and select **Copy credential**. To save/export access, paste the credential into your own secure password manager or private saved file. The credential is the saved access record; there is no separate export archive.
3. On another device, open the same URL, paste the credential into **Join with a saved credential**, and select **Join Inbox**. Both devices see the same Inbox across projects and Agent sessions.
4. Configure Codex using [the agent guide](agents/codex.md). Set the bearer token environment variable on the computer that launches Codex and configure the paired HTTPS `/mcp` endpoint. Keep the JWT out of URLs, prompts, source files, screenshots, and logs.

There is no account, recovery, automatic credential expiry, or token rotation. Losing all copies means losing access; clearing browser storage removes that browser's saved copy. Anyone with the credential is trusted to ask, read, answer, and delete Questions. There are no separate phone/agent roles. The JWT signing secret belongs to the operator and is different from your shared credential.

## Answer Questions

Read the wording, project, Agent session, and optional supporting Markdown/code. Swipe on the wording area: **right for Yes**, **left for No**, **up for Custom answer**. Equivalent **Yes**, **No**, and **Custom answer** controls are available; supporting text remains scrollable.

A binary choice is unsent until the server acknowledges it. Its three-second **Undo** window starts at acknowledgment. Select Undo before the deadline to withdraw it; the Question stays pending. Closing the page after acknowledgment does not withdraw the choice or reset the deadline. After commitment, the Response is final and available to agents. An unacknowledged request is shown as unsent; reconnect/retry to check the authoritative outcome rather than assuming delivery.

Custom answer opens a composer without answering. Type a nonempty response such as “Yes, but preserve the database.” **Close** leaves the Question pending; **Send** commits the exact text immediately, with no Undo window. Committed Responses cannot be edited; follow-up discussion needs a new Question. A competing answer or explicit agent cancellation may already have won; the app then shows that existing outcome. An agent disconnection does not cancel anything.

## Navigate and follow up

The **Pending Questions** list lets you read another Question without answering the current one. Agent `prioritize_question` promotes a pending Question; priority Questions supply the next card before normal Questions, oldest first by original creation time. A newly arrived/promoted Question does not replace the card already open. Selection also remains stable through ordinary live updates and reconnects; reloading chooses from the authoritative queues.

Open **Response history** to read committed Responses with their Questions, projects, Agent sessions, and timestamps. It is read-only. Finished content expires after seven days; pending Questions do not expire. An expired Question ID remains reserved so an identical agent retry does not recreate its card.

Agents can **wait** for a committed Response through `wait_for_response`, or **continue independent work** after `submit_question` and later use `get_response`/a bounded wait. Retain the chosen UUIDv7 ID and exact original content. A wait timeout means no final answer yet, never implicit approval. Reconnect/restart retrieval uses the same ID and credential. Tested Codex 0.159.2 uses MCP 2025-06-18 with the app's explicit compatibility support; SDK 2.2.0 also supports the target 2026-07-28 revision. Native Tasks and automatic idle-agent resumption were not demonstrated.

## Delete an Inbox

Select **Delete Inbox** and read Chrome's confirmation. Cancel keeps it. Confirm permanently deletes application records, clears this browser's saved credential, and invalidates access for every paired browser and agent. There is no restoration or recovery. A failed acknowledgment preserves your local credential until the app checks access again; deletion may already have committed, so reconnect to learn the result. Other Inboxes are unaffected.

The pilot has no backups or automatic volume snapshots. Ordinary server restarts preserve Inboxes and acknowledged deadlines, but an irrecoverable volume failure can lose them. Expiry/deletion remove application records without promising forensic erasure of old disk bytes.

## Acceptance session

Create a disposable Inbox and pair a real Codex agent and second Chrome device. Have agents submit several Questions with projects/session labels and supporting Markdown. Exercise all three swipes and visible controls, Undo, closing/reopening Custom, conditional Custom Send, priority/manual selection, history, and both wait/continue modes. Interrupt the phone connection and reopen/reconnect; ask the operator to restart during an acknowledged Undo window and verify the same credential and outcomes afterward. Finally delete the disposable Inbox and verify both devices and the agent lose access. Share only sanitized outcomes, exact Chrome/Codex versions, and errors with the operator; do not include credentials or publicly post the pilot URL.

The operator must finish [hosted HTTPS streaming/restart checks](pilot-operator.md#health-streaming-and-restart) before treating the pilot as verified. Current [release evidence](research/release-smoke.md) distinguishes local success from remaining hosted gates.
