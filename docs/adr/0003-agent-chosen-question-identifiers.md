# Agent-chosen question identifiers

A submission may succeed even when the agent loses the connection before receiving the result, so server-assigned identifiers alone would allow retries to create duplicate Questions. Agents choose a UUIDv7 Question ID before submission; the server enforces uniqueness within the authenticated Inbox and makes submissions idempotent using that ID rather than a separate request key. A retry with the same ID and original content returns the existing Question's outcome; conflicting content is rejected rather than changing what the human may already have read.

## Consequences

Finished Question and Response text expires after seven days, but a minimal marker containing the Question ID and original-content fingerprint remains so retries cannot recreate an expired card. An identical retry returns an expired outcome; conflicting content is rejected. Inbox deletion removes these markers along with the rest of its data and invalidates its credential.
