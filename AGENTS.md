# Repository Guidelines

Contributor guide for `pi-wren-platform`, an enterprise agent platform pairing the Pi Agent Runtime with the Wren Context Engine.

## Project Structure & Module Organization

pnpm-workspaces monorepo (`pnpm-workspace.yaml`); all code is TypeScript. Each workspace owns a single concern:

- `apps/api` — Express API: config validation, logging, health, `/api/agent/chat` (`src/`)
- `apps/web` — Next.js chat console with execution trace and result table (`app/chat/`)
- `services/agent-runtime` — agent execution: planner, tool registry, events, memory, `FinanceAgent` (`src/agents/`)
- `services/context-engine` — Wren semantic layer: Wren AI client (`src/wren/`), demo SQL generation, metric definitions
- `services/data-engine` — PostgreSQL pool and SQL executor (`src/`)
- `packages/agent-sdk` — LLM providers (OpenAI/Anthropic/Ollama/Mock) (`src/providers/`)
- `packages/shared-types` — cross-boundary contracts (`src/index.ts`)
- `infra/postgres` — schema and seed SQL (`init.sql`); `docs` — architecture and roadmap

Put cross-cutting contracts in `packages/shared-types`; wire business logic through constructor-injected dependencies so tests can substitute fakes.

## Build, Test, and Development Commands

Run from the repository root:

- `pnpm install` — install dependencies (`--frozen-lockfile` in CI)
- `pnpm dev` — start all workspaces in parallel (API :8080, Web :3000)
- `pnpm build` — build every workspace (API bundled by tsup, Web by Next)
- `pnpm lint` / `pnpm typecheck` / `pnpm test` — lint, type-check, and run Vitest across workspaces
- `docker compose up -d` — start PostgreSQL and Redis (uses local images; see `docker-compose.yml`)

## Coding Style & Naming Conventions

- TypeScript, 2-space indentation, semicolons, single quotes (Prettier enforced).
- Strict mode, `verbatimModuleSyntax` (use `import type` for type-only imports).
- `interface` for shapes, small classes for services, kebab-case filenames (`sql-runner.ts`), camelCase functions/variables.
- Validate environment configuration with zod in `apps/api/src/config.ts`.

## Testing Guidelines

- Vitest; tests colocated as `*.test.ts` next to the code they cover.
- Name by behavior: `describe('FinanceAgent')` with `it('runs the full pipeline without a model')`.
- Cover provider clients (mock `fetch`), SQL generation, result analysis, the agent pipeline (inject fakes), and the API (integration test over an ephemeral port).

## Commit & Pull Request Guidelines

- Conventional Commits, lowercase and imperative: `feat: add wren sql generation tool`, `fix: correct metric lookup`.
- One logical change per commit; PRs against `main` link an issue, summarize what/why, list manual verification, and include screenshots for UI changes.
