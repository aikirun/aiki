---
"@aikirun/app-dashboard": minor
"@aikirun/app-server": minor
"@aikirun/cli": minor
"@aikirun/examples": minor
"@aikirun/lib": minor
"@aikirun/http": minor
"@aikirun/memory": minor
"@aikirun/redis": minor
"@aikirun/client": minor
"@aikirun/endpoint": minor
"@aikirun/iam": minor
"@aikirun/server": minor
"@aikirun/worker": minor
"@aikirun/workflow": minor
"@aikirun/types": minor
---

## 0.29.0

### New Features

- **Embedded transport.** `client({ handler: aiki.handler })` runs client and server in the same process with no network hop. Workers and workflows are unchanged; switching transports is a config-only change.
  ```typescript
  const aiki = server({ db });
  const aikiClient = client({ handler: aiki.handler });
  ```

- **`@aikirun/memory` adapter package.** Exports `inMemoryQueue` and `inMemoryTimerPriorityQueue` — the in-memory analog of the Redis adapter, useful for embedded / single-process setups and tests.

- **`@aikirun/iam` package — pluggable identity & access management.** Extracted from `@aikirun/server`. The server's `iam` parameter is optional: omit it and the server runs with a no-op API authorizer; the dashboard probes a capabilities endpoint and renders a no-op UI.
  ```typescript
  import { iam } from "@aikirun/iam";
  server({ db, iam: iam({ db, secret, baseURL, trustedOrigins }) });
  ```

- **Optional client API key.** `client({ url })` works without an `apiKey`, paired with a server running without IAM.

- **Lazy DB provider loading.** The server defers loading the `postgres` driver until the handler or runtime actually starts. `postgres` is now a peer dependency of `@aikirun/server` and `@aikirun/iam`, so hosts that don't use Postgres no longer pull the driver into their bundle.

### Improvements

- **Discard in-flight tasks on workflow cancel.** Cancelling a run now discards its in-flight tasks rather than letting them complete.
- **Outbox cleanup on task retry and bulk cancel.** Closes missing cleanup paths.
- **Sleep queue / `state_transition` fix.** Only complete sleep queue entries of runs that actually transitioned, preventing dangling `state_transition` rows when revisions mismatch.
- **Backup subscriber bug fix.** The backup subscriber was only being created when there was *no* primary; the condition was inverted.
- **`AIKI_SERVER_AUTH_SECRET` and `AIKI_SERVER_BASE_URL` are optional** in `app/server`.
- **`@aikirun/lib` reorganization.** `@aikirun/lib/array` → `@aikirun/lib/collection/array`, `@aikirun/lib/heap` → `@aikirun/lib/collection/heap`.
- **GitHub PR workflow** for typecheck, lint, and build.

### Breaking Changes

- **`WorkflowRun` (the persisted record) renamed to `WorkflowRunRecord`.** A new `WorkflowRun` exists in `@aikirun/workflow` for the handler's `run` object (previously `WorkflowRunContext`).
  ```typescript
  // Before
  import type { WorkflowRun } from "@aikirun/types/workflow/run";

  // After
  import type { WorkflowRunRecord } from "@aikirun/types/workflow/run";
  ```

- **`WorkflowRunContext` removed.** The handler's `run` parameter is now typed as `WorkflowRun` from `@aikirun/workflow`.

- **`appContext` → `context`, and accessed via `run.context` instead of the handler's third parameter.** Bind `Context` on `workflow<Context>()` and `client<Context>()`.
  ```typescript
  // Before
  const myWorkflow = workflow({ name: "x" });
  myWorkflow.v("1", {
    async handler(run, input, appContext: AppContext) { /* ... */ },
  });
  client<AppContext>({ url, apiKey, appContext: (run) => ({ /* ... */ }) });

  // After
  const myWorkflow = workflow<Context>({ name: "x" });
  myWorkflow.v("1", {
    async handler(run, input) {
      const ctx = run.context;
    },
  });
  client<Context>({ url, apiKey, context: (run) => ({ /* ... */ }) });
  ```

- **`TimerSortedSet` → `TimerPriorityQueue`** (type, `CreateTimerSortedSet` → `CreateTimerPriorityQueue`, `redisTimerSortedSet` → `redisTimerPriorityQueue`). Server runtime param renamed accordingly:
  ```typescript
  // Before
  server({ runtime: { timerSortedSet: redisTimerSortedSet(redis, "aiki:timers") } });

  // After
  server({ runtime: { timerPriorityQueue: redisTimerPriorityQueue(redis, "aiki:timers") } });
  ```

- **`server()` shape changed.** `db` is now a `CreateDatabase` factory built via `database(...)`; auth config moved out of `handler` and into the optional `iam` parameter. `ServerHandlerParams` / `ServerHandlerAuthParams` removed.
  ```typescript
  // Before
  import { server } from "@aikirun/server";
  server({
    db: { provider: "pg", url: "..." },
    handler: { auth: { secret, baseURL, trustedOrigins } },
  });

  // After
  import { database, server } from "@aikirun/server";
  import { iam } from "@aikirun/iam";
  const db = database({ provider: "pg", url: "..." });
  server({
    db,
    iam: iam({ db, secret, baseURL, trustedOrigins }),
  });
  ```

- **`aiki migrate` requires `--package`.** Pick `server` or `iam`; each owns its own migration table (`__drizzle_migrations__server`, `__drizzle_migrations__iam`).
  ```bash
  # Before
  aiki migrate apply
  aiki migrate generate

  # After
  aiki migrate apply --package server
  aiki migrate generate --package iam
  ```

- **`@aikirun/server/config` subpath export removed.** `loadDatabaseConfig` and `DatabaseProvider` moved out of `@aikirun/server`. Use `DATABASE_PROVIDERS` / `isDatabaseProvider` from `@aikirun/types/infra/db`.

- **`@aikirun/types/api/api-key` and `@aikirun/types/api/namespace` exports removed.** These schemas are now internal to `@aikirun/iam`.

- **`app/web` renamed to `app/dashboard`.** Npm script is now `bun run dashboard`; Docker image is `aiki-dashboard`. Env var `AIKI_WEB_PORT` → `AIKI_DASHBOARD_PORT`.
