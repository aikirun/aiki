# AGENTS

Follow these repository-wide rules when changing the AIKI repository.

## Working Rules

- Use `bun` commands at repo root. Do not use `npm install` at the root.
- Prefer root scripts in `package.json` unless there is a clear reason to run a package-local command.
- Keep changes focused; avoid unrelated refactors.
- Run relevant verification before finishing (at minimum: check + lint + tests impacted by your change).

## Architecture & Structure

Each package in the monorepo is a separate Bun workspace. The root `package.json` contains scripts that run commands across all workspaces.

### Repository Structure

- Monorepo name: `aiki`
- Package manager/runtime: **Bun**
- Workspace model: Bun workspaces (`workspace:*` links)
- Prefer small, focused `tsconfig.json` files: one per feature or bootstrap component, referenced by a root config with `include: []`. A single `main/tsconfig.json` is acceptable for small systems.

### Components

- app folder contains the follwoing web applications:
    - server: the API server
    - dashboard: the web dashboard
    - website: the documentation site

- sdk folder contains the following packages:
    - adapter: adapters for runtime integration (for example, Redis-based delivery/timers via `@aikirun/redis`)
    - client: typed client for starting workflows, sending events, and observing runs
    - endpoint: serverless endpoint handler that verifies signed requests and executes workflows
    - iam: optional IAM module for organizations, namespaces, API keys, and dashboard auth
    - server: server library that orchestrates workflow runs and persists state in your database
    - worker: long-lived worker processes that claim ready runs and execute workflow code
    - workflow: workflow/task primitives for durable, versioned, retried, and resumable execution

## Code standards

### TypeScript style

For TypeScript conventions, see docs/TYPESCRIPT.md

### Naming Conventions

- Use `kebab-case` for file names and directories.
- Prefer clarity over brevity; avoid vague names like "item", "manager", "data", "handle".

## Database and Migrations

For database and migration conventions, see docs/DB.md

## Local End-to-End Run (Server + Dashboard)

For local end-to-end runs, see docs/LOCAL.md.

## Common Commands

- Need full type safety across repo: `bun run check`
- Need style/format validation: `bun run lint`
- Need automatic formatting/lint fixes: `bun run lint:fix`
- Need package artifacts for publishable libs: `bun run build:packages`
- Need all build outputs: `bun run build`
- Need local server API: `bun run server`
- Need dashboard frontend: `bun run dashboard`
- Need docs site: `bun run website`
