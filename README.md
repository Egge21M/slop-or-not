# slop-or-not

Slop or Not will let coding agents ask yes/no questions through MCP and receive human responses from a regular web app on a phone. Users swipe right for yes, left for no, or up to send a custom answer.

The agreed first-version scope and acceptance scenarios live in [GitHub issue #1](https://github.com/Egge21M/slop-or-not/issues/1). Domain terms are defined in [GLOSSARY.md](./GLOSSARY.md), architectural decisions are recorded in [docs/adr/](./docs/adr/), and [MCP delivery research](./docs/research/mcp-phone-response-delivery.md) explains the Codex compatibility check required before selecting the delivery transport.

The [agreed technical scope](./docs/technical-scope.md) selects React/Vite initialized with shadcn, a Bun server, Drizzle over `bun:sqlite`, authenticated phone SSE, and the official MCP SDK. The pilot targets latest stable Chrome and one always-running Fly.io Machine with a persistent volume and no backups.

The repository still contains the Bun monorepo starter with a greeting CLI and a shared TypeScript package; the selected app stack has not been initialized. The commands below describe that starter.

- `apps/cli` contains the runnable app, `@slop-or-not/cli`.
- `packages/shared` exports TypeScript source as `@slop-or-not/shared`.
- `tsconfig.json` provides shared compiler settings.
- `bun.lock` locks dependencies for every workspace.

Use Bun 1.4.2, as recorded in `package.json`.

Install dependencies from the repository root:

```bash
bun install
```

Run the CLI in watch mode:

```bash
bun run dev
```

Run it once with `bun run start`. Both commands print `Hello via Bun!` using an import from the shared workspace.

Check types, run tests, and build the app:

```bash
bun run check
```

You can also run `bun run typecheck`, `bun run test`, and `bun run build` separately. The test command allows an empty test suite until you add `*.test.ts` files beside the source.

The build writes `apps/cli/dist/index.js`. Run the bundle with:

```bash
bun apps/cli/dist/index.js
```

To add a workspace, create a directory under `apps/` or `packages/` with its own `package.json` and a unique name. Extend the root TypeScript configuration and add a `typecheck` script. Add a `build` script if the workspace needs build output.

Declare local dependencies with `"workspace:*"`, then run `bun install` at the root to update workspace links and the lockfile. The shared package exports source directly, so it needs no separate build step.

To run a script in one workspace:

```bash
bun run --filter @slop-or-not/cli start
```

See the [Bun workspace documentation](https://bun.com/docs/pm/workspaces) for workspace configuration and dependency management.
