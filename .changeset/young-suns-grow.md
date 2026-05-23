---
"@aikirun/app-server": minor
"@aikirun/app-web": minor
"@aikirun/cli": minor
"@aikirun/examples": minor
"@aikirun/lib": minor
"@aikirun/http": minor
"@aikirun/redis": minor
"@aikirun/client": minor
"@aikirun/endpoint": minor
"@aikirun/server": minor
"@aikirun/worker": minor
"@aikirun/workflow": minor
"@aikirun/types": minor
---

### New Features

- **`@aikirun/server` is now an embeddable library.** A new `server()` factory builds an Aiki instance you can mount into your own host process. At v0.27.0 the package was only consumable as a standalone binary; you can now compose it inside your own HTTP server.
  ```typescript
  import { server } from "@aikirun/server";
  import { redisCache, redisPublisher, redisTimerSortedSet } from "@aikirun/redis";

  const aiki = server({
    db: config.database,
    cache: redisCache(redis),
    logger,
    handler: { auth: { secret, baseURL, trustedOrigins } },
    runtime: {
      publisher: redisPublisher(redis),
      timerSortedSet: redisTimerSortedSet(redis, "aiki:timers"),
    },
  });
  const runtimeHandle = await aiki.runtime.start();
  // aiki.handler is a (Request) => Promise<Response> you can mount on any server
  ```

- **New `@aikirun/cli` package, shipping the `aiki` binary.** Provides `aiki migrate apply` and `aiki migrate generate [--custom]`. The bundled Drizzle config ships inside the CLI, so when you self-host Aiki, your own application no longer needs its own Drizzle config or migration runner to apply Aiki's schema.

- **Pluggable infrastructure factories.** `Publisher`, `Cache`, and `TimerSortedSet` are now injected into the server via factory functions (`CreatePublisher`, `CreateCache`, `CreateTimerSortedSet` from `@aikirun/types/infra/*`). At v0.27.0, Redis was hard-wired into the server.

- **New `redisCache` adapter in `@aikirun/redis`.** At v0.27.0 the API-key cache used Redis inline inside the server; there was no exported cache adapter you could swap or reuse.

- **`namespaceId` is now carried on every ready run message** (`ReadyWorkflowRun.namespaceId`), so publishers/subscribers can route without an extra lookup.

### Improvements

- **The server uses Aiki's `Logger` interface throughout** instead of Pino directly. Bring your own logger by implementing the `Logger` contract — re-exported from `@aikirun/server` (and from `@aikirun/client` / `@aikirun/worker` for those surfaces).

- **Factory shapes (`CreateCache`, `CreatePublisher`, `CreateSubscriber`, `CreateTimerSortedSet`) are now synchronous.** Defer any async setup lazily inside the returned implementation.

- **`cache` is a top-level field in `ServerParams`.** Each cache instance picks its own `keyPrefix` via the `CacheContext` passed to the factory call, instead of the prefix being baked into one adapter-wide option.

- **Graceful shutdown drains daemons before closing Redis**, so in-flight daemon work doesn't trip over a closed connection.

- **`@aikirun/types` is reorganized into domain folders** (`api/*`, `infra/*`, `workflow/*`, `workflow/run`, `workflow/task`). The SDK barrels (`@aikirun/workflow`, `@aikirun/client`, `@aikirun/worker`, `@aikirun/server`) re-export the user-facing types you'll need, so most consumers should import from the SDK package directly rather than from `@aikirun/types/*`.

### Breaking Changes

- **`ClientParams.createContext` renamed to `appContext`.** This is the only purely user-facing rename in the client surface.
  ```typescript
  // Before
  client({ url, apiKey, createContext: (run) => ({ traceId: ... }) });
  // After
  client({ url, apiKey, appContext: (run) => ({ traceId: ... }) });
  ```

- **Subscriber contract reshaped.** Affects anyone implementing a custom subscriber (the bundled subscribers are already updated).
  - `Subscriber.getNextBatch` renamed to `getReadyRuns`.
  - `WorkflowRunMessage.data.workflowRunId` renamed to `data.id`.
  - `CreateSubscriber` may no longer return `Promise<Subscriber>` — it must return `Subscriber` synchronously.
  - Types moved: `@aikirun/types/subscriber` → `@aikirun/types/infra/queue`.
  ```typescript
  // Before
  import type { CreateSubscriber } from "@aikirun/types/subscriber";
  const sub: Subscriber = { getNextBatch: async (n) => [{ data: { workflowRunId } }] };
  // After
  import type { CreateSubscriber } from "@aikirun/types/infra/queue";
  const sub: Subscriber = { getReadyRuns: async (n) => [{ data: { id } }] };
  ```

- **Publisher contract reshaped.** Affects anyone implementing a custom publisher.
  - Interface `WorkflowRunPublisher` renamed to `Publisher`.
  - Payload type `WorkflowRunReadyMessage` renamed to `ReadyWorkflowRun`.
  - Module path: `server/infra/messaging/types` → `@aikirun/types/infra/queue`.
  - The `publishReadyRuns` signature still requires `NonEmptyArray<ReadyWorkflowRun>` — that part is unchanged from v0.27.0; only the type and interface names moved.

- **`@aikirun/server` config types renamed.** Only relevant if you embed the server via the new `server()` factory.
  - `ServerHandlerAuth` → `ServerHandlerAuthParams`.

- **`Logger` is no longer exported from `@aikirun/types/logger`.** Import it from the SDK barrel you're already using (`@aikirun/client`, `@aikirun/server`, or `@aikirun/worker`).
  ```typescript
  // Before
  import type { Logger } from "@aikirun/types/logger";
  // After
  import type { Logger } from "@aikirun/client";   // or @aikirun/server / @aikirun/worker
  ```

- **`logger.child()` argument renamed from `context` to `bindings`.** Behavior unchanged; only relevant if you implement the `Logger` interface yourself and were destructuring the parameter name.

- **`@aikirun/types` export paths reorganized.** If you imported subpaths directly (not via SDK barrels), update them. Notable moves:
  - `@aikirun/types/workflow-run` → `@aikirun/types/workflow/run`
  - `@aikirun/types/workflow-run-error` → `@aikirun/types/workflow/run` (errors are exported from the same barrel)
  - `@aikirun/types/task`, `@aikirun/types/task-error` → `@aikirun/types/workflow/task`
  - `@aikirun/types/subscriber` → `@aikirun/types/infra/queue`
  - `@aikirun/types/workflow-run-api` → `@aikirun/types/api/workflow-run`
  - `@aikirun/types/schedule-api` → `@aikirun/types/api/schedule`
  - `@aikirun/types/namespace-api` → `@aikirun/types/api/namespace`
  - `@aikirun/types/api-key-api` → `@aikirun/types/api/api-key`

- **Utility-type subpaths removed from `@aikirun/types`.** `array`, `duration`, `property`, `retry`, `serializable`, etc. are no longer exported subpaths. Import these from the SDK you're using — `@aikirun/workflow` re-exports `Duration`, `RetryStrategy`, `Serializable`, and so on.

- **Database migrations now run via `aiki migrate apply`** (from `@aikirun/cli`). The standalone migrate entry point at `server/infra/db/migrate.ts` is gone.

- **Redis transport package layout changed.** Package names `@aikirun/redis` and `@aikirun/http` are unchanged, but if you reference them by workspace directory, the directories moved from `sdk/transport/` to `sdk/adapter/`.