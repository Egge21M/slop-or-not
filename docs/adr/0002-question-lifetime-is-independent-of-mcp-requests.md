# Question lifetime is independent of MCP requests

An agent may wait for a Response or continue independent work, and an MCP request can end before the human answers. Questions therefore remain durable and retrievable after disconnects or wait timeouts, until explicitly cancelled or answered; losing a connection never implies an answer. We will investigate native MCP Tasks with SSE result delivery against Codex first, while permitting ordinary submission, retrieval, and bounded-wait tools as a fallback if that capability is unavailable.
