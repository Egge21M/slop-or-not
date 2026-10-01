# Phone web workspace

Initialized using `bunx --bun shadcn@4.21.0 init --template vite --preset nova --base base --no-monorepo --name web --yes -c apps` from the repository root. The starter's shadcn component and Tailwind setup are retained; React/Vite/TypeScript versions are pinned through the root Bun lock.

Run `bun run dev` at the root to start both workspaces. `bun run build` produces Vite assets served by the Bun server in production. Configuration, credentials, and MCP pairing are documented in the root README.

`lib/api.ts` owns bearer HTTP calls, `lib/useInbox.ts` owns authenticated SSE/reconnection and stable card selection, `PairingPanel.tsx` owns credential pairing, and `QuestionCard.tsx` owns the current binary controls. Supporting Markdown and additional response modes are added in their feature tickets.
