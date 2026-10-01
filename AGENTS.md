
Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use Vite through Bun for frontend builds, and `bun build` for backend builds.
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- Use Drizzle with `bun:sqlite` for SQLite, and checked-in SQL migrations.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use React and TypeScript with Vite, initialized using the shadcn Vite starter. Run the shadcn CLI and Vite with Bun explicitly (`bunx --bun`); use Bun for dependency installation and script execution.

Keep frontend and server in separate Bun workspaces. Vite builds the production frontend assets; `Bun.serve()` serves those assets, the HTTP API, and MCP from the same origin. Use a Vite proxy during development. Target latest stable Chrome.

Before changing application structure, persistence, authentication, live updates, or deployment, read [the technical scope](docs/technical-scope.md).

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `Egge21M/slop-or-not`. Read `docs/agents/issue-tracker.md` before ticket operations.

### Triage labels

Use the five default triage labels. Read `docs/agents/triage-labels.md` before triage or applying triage labels.

### Domain docs

Single-context: root `GLOSSARY.md` and `docs/adr/`. Read `docs/agents/domain.md` before exploring the codebase.
