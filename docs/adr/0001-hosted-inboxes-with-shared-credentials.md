# Hosted inboxes with shared credentials

Slop or Not starts as a hosted service so a user can answer coding questions from a phone away from the coding machine; supporting user-run servers is outside the first version. Each pseudonymous personal inbox spans projects and agent sessions, with concurrent submitting agents and no team ownership. The phone and agents share one JWT: possession grants both question submission and response access, deliberately trusting credential holders rather than separating human and agent roles in the first version.

Pairing starts in the regular mobile web app, which creates an inbox and retrieves its shared token for agent configuration. There is no credential recovery in the first version; losing every copy of the token means losing access to that inbox.

The initial hosted release is a private pilot for a trusted testing group. Tokens have no automatic expiry in this version; deleting an inbox invalidates its token, and standalone token rotation is deferred.

The browser persists the shared credential in localStorage and presents it for copying into MCP configuration. Both the browser API/SSE stream and agents use bearer authentication. Credential readability is deliberate; credentials must stay out of URLs and logs, and every access checks that the Inbox still exists.
