# Repository Guidelines

Contributor guide for `pi-wren-platform`: an enterprise agent platform that answers natural-language business questions with LLM-generated SQL against real databases (Pi Agent Runtime + Wren-style context layer).

## Project Structure & Module Organization

pnpm-workspaces monorepo (`pnpm-workspace.yaml`); all code is TypeScript. Each workspace owns a single concern:

- `apps/api` — Express API: zod config, pino logging, health, `/api/agents`, `/api/agent/:domain/chat` (`src/`)
- `apps/web` — Next.js chat console: multi-agent switcher, trace, SQL, result table (`app/chat/`)
- `services/agent-runtime` — agent execution: planner, tool registry, events, memory, domain-driven `DataAnalysisAgent` (`src/agents/`), LLM SQL generation + safety validation (`src/context/`)
- `services/context-engine` — semantic layer: Wren AI client (`src/wren/`), MDL-style config engine (`src/mdl/`)
- `services/data-engine` — PostgreSQL pool and SQL executor (`src/`)
- `packages/agent-sdk` — LLM providers (OpenAI-compatible/Anthropic/Ollama/Mock) (`src/providers/`)
- `packages/shared-types` — cross-boundary contracts (`src/index.ts`)
- `semantic/` — MDL-style YAML configs (`finance.mdl.yml`, `insurance.mdl.yml`): models/intents/metrics/knowledge
- `infra/postgres` — schema + seed (`init.sql`, `insurance_schema.sql`, `insurance_seed.sql`); `docs` — architecture and roadmap

How the pieces fit: a new agent = a domain config (`src/agents/domain.ts`) + a semantic YAML; the pipeline code is unchanged. All business dependencies are constructor-injected so tests substitute fakes.

## Build, Test, and Development Commands

Run from the repository root:

- `pnpm install` — install dependencies (`--frozen-lockfile` in CI; pnpm 11 uses `allowBuilds` in `pnpm-workspace.yaml`)
- `pnpm dev` — start API (:8080) and Web (:3000). Do not run `pnpm build` while dev is running (shared `.next` cache)
- `pnpm build` / `pnpm lint` / `pnpm typecheck` / `pnpm test` — build, lint, type-check, and run Vitest (46 tests) across workspaces
- `docker compose up -d` — PostgreSQL/Redis using local images (see `docker-compose.yml`)
- Configuration: create `.env` at the repo root (see `.env.example`); the API auto-loads it via dotenv. `LLM_PROVIDER` (`mock|openai|anthropic|ollama`) switches between offline rule-based mode and LLM-powered SQL generation.

## Coding Style & Naming Conventions

- TypeScript, 2-space indentation, semicolons, single quotes (Prettier enforced).
- Strict mode, `verbatimModuleSyntax` (`import type` for type-only imports), `noUncheckedIndexedAccess`.
- `interface` for shapes, small classes for services, kebab-case filenames (`sql-runner.ts`), camelCase functions/variables.
- Validate environment configuration with zod in `apps/api/src/config.ts`; semantic YAML is validated by `src/mdl/loader.ts`.

## Testing Guidelines

- Vitest; tests colocated as `*.test.ts` next to the code they cover.
- Name by behavior: `describe('LlmContextEngine')` with `it('falls back when the LLM returns a dangerous statement')`.
- Cover provider clients (mock `fetch`), SQL validation, intent matching, the agent pipeline (inject fakes), and the API (integration over an ephemeral port).

## Commit & Pull Request Guidelines

- Conventional Commits, lowercase and imperative: `feat: add llm-powered sql generation`, `fix: raise proxy timeout for slow llm`.
- One logical change per commit; PRs against `main` link an issue, summarize what/why, list manual verification, and include screenshots for UI changes.
