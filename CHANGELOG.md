# Changelog

All notable changes to Aiki packages are documented here. All `@aikirun/*` packages share the same version number and are released together.

## 0.34.1

This release keeps a worker's server-side run claim alive on its own fixed cadence, independent of `heartbeatIntervalMs`, so a large heartbeat interval no longer lets a still-running claim be reassigned to another worker.

### Bug Fixes

- **Run claims no longer expire under a large `heartbeatIntervalMs`.** A worker keeps its server-side claim on an executing run alive on a fixed 30s cadence, derived from the ~90s reclaim threshold and independent of `heartbeatIntervalMs`. Previously the server keepalive rode on the configurable execution heartbeat and was throttled but never floored — setting `heartbeatIntervalMs` above the reclaim threshold let a still-running claim be treated as abandoned and picked up by a second worker.

### Improvements

- **`claimMinIdleTimeMs` is optional on the claim API.** The server fills the default (90s) when it's omitted.

## 0.34.0

This release changes how the database TLS connection is configured: the `DATABASE_SSL` flag is gone, TLS is now driven by the connection URL's `sslmode`, and a new `DATABASE_CA_CERT` lets you verify the server certificate against a private CA.

### Breaking Changes

- **`DATABASE_SSL` removed; TLS now driven by the connection URL's `sslmode`, with `DATABASE_CA_CERT` for private CAs.** The boolean `DATABASE_SSL` flag is gone. Enable TLS via the standard `sslmode` parameter on `DATABASE_URL`, and set `DATABASE_CA_CERT` (PEM contents) when you need to verify the server certificate against a private CA (e.g. DigitalOcean, RDS). When a CA cert is provided, the connection verifies with `rejectUnauthorized: true`.

  ```bash
  # Before
  DATABASE_URL=postgresql://user:password@host:5432/aiki
  DATABASE_SSL=true

  # After — enable TLS via the URL, verify against a private CA if needed
  DATABASE_URL=postgresql://user:password@host:5432/aiki?sslmode=require
  DATABASE_CA_CERT="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
  ```

  This affects the `DATABASE_*` env vars across `.env.example`, both `docker-compose.yml` files, the release workflow, and the installation docs. Update any deployment that set `DATABASE_SSL`.

## 0.33.0

This release ships a self-contained `aiki` binary for hosting the server without Node, Bun, or Docker, and reshapes schedules around a reference-first identity model — schedules are now identified by reference, with per-run retry and shard options.

### New Features

- **Retry and shard options for scheduled runs.** A schedule can now set the retry policy and shard for every run it fires, via the builder's `workflowRun.*` paths. When you set nothing, each fired run inherits the workflow's declared `retry` default; a schedule-level override replaces it.

  ```typescript
  await everyFiveSeconds
    .with()
    .opt("reference.id", "my-correlation-xxx")
    .opt("workflowRun.retry", { type: "exponential", maxAttempts: 3, baseDelayMs: 1_000 })
    .opt("workflowRun.shard", "eu")
    .activate(client, notify, "This is a reminder");
  ```

- **Prebuilt `aiki` binary in every release.** A single self-contained executable — its own runtime, no Node, Bun, or Docker — carrying the `migrate` and `server` commands. Download it from the release, put it on `PATH`, and run `aiki migrate apply` then `aiki server start`.

- **Per-package migration bins.** `aiki-server` and `aiki-iam` each ship their own migrate CLI (`aiki-server migrate apply`), replacing the single `aiki migrate apply --package <name>` entrypoint. SDK users no longer need `@aikirun/cli` as a devDependency.

- **`--env-file` for the standalone server.** Both `migrate` and `server` commands read config from the environment; pass `--env-file <path>` to load it from a file instead.

### Web UI

- Reworked the runs list and sidebar layout; polished run and schedule metadata rows and runs-list back navigation.
- Overhauled the schedules list page.

### Improvements

- **`PathFromObject` treats union-typed properties as atomic leaves.** Builder `.opt()` paths (schedules, etc.) no longer descend into the branches of a union, discriminated union, or optional union — the whole union is set as one value.
- Migration apply is decoupled from the filesystem via a pluggable migration source, so migrations can be embedded in the `aiki` binary.
- The app-server boot function was extracted (`startAppServer` now takes config), and a sensible local CORS default was added.
- The `sha256` helpers are now documented as content-addressing hashes — fingerprints and high-entropy secrets only, never user passwords.

### Bug Fixes

- **Prototype pollution guard** — object merge and overrider now skip own `__proto__` keys.
- **Open-redirect fix** — the dashboard auth redirect param is resolved against the origin to close a bypass.
- **LIKE-pattern escaping** — backslashes in the workflow-name prefix filter are now escaped.

### Breaking Changes

- **Schedule `input` renamed to `workflowRunInput`** — in the activate request and the `Schedule` type.

  ```typescript
  // Before
  { workflowName, workflowVersionId, input, spec, options }
  // After
  { workflowName, workflowVersionId, workflowRunInput, spec, options, workflowRunOptions }
  ```

- **`ScheduleReferenceOptions` renamed to `ScheduleReference`** — the `Options` suffix was dropped from the reference identity type.

- **Schedule conflict policies changed** from `["upsert", "error"]` to `["error", "return_existing"]` (default `error`). Re-activating with the same reference id now either errors or returns the existing schedule; definitions are immutable (no upsert or redefine). This is the reference-first schedule identity model: reference is identity, definition hash is the idempotency key.

- **CLI and db-script reshape (ops-facing):**

  ```bash
  # Before                                    # After
  npx aiki migrate apply --package server  →  npx aiki-server migrate apply
  bun run db:migrate:server                →  bun run db:migrate:apply:server
  bun run db:migrate:iam                   →  bun run db:migrate:apply:iam
  ```

## 0.32.0

This release makes Aiki self-hostable from published container images — no clone, no local build — and fixes workflow replay to stop re-validating already-persisted outputs.

### New Features

- **Official container images on GitHub Container Registry.** `ghcr.io/aikirun/server`, `ghcr.io/aikirun/dashboard`, and `ghcr.io/aikirun/cli` are published per release, multi-arch (amd64 + arm64). The standalone stack now runs from a one-command download instead of a clone:

  ```bash
  mkdir aiki && cd aiki
  curl -fsSL https://github.com/aikirun/aiki/releases/latest/download/docker-compose.yml -o docker-compose.yml
  # add a .env with DATABASE_URL, then:
  docker compose up -d
  ```

  The stack runs a migrate container first — driven by `AIKI_MIGRATE_PACKAGES` (default `server`, plus `iam` when `AIKI_SERVER_AUTH_SECRET` is set) — then starts the server once it completes.

- **`aiki migrate list --package <server|iam>`.** Lists the migrations a package ships, reading its migration journal without connecting to a database.

- **The dashboard Docker image is configured at runtime.** nginx in the image serves the SPA and reverse-proxies API calls to `AIKI_SERVER_UPSTREAM_URL`, read at container start. Browser traffic stays same-origin, so the image needs no CORS setup.

### Bug Fixes

- **Workflow replay no longer re-validates already-persisted task and child-workflow outputs.** An output is validated against its schema when it's produced, before it's persisted. On replay, the stored output is now returned as-is rather than re-parsed. Re-parsing was unsafe: a validator that mutates its value (e.g. appends to a string) would double-apply on every replay, and a schema that changed after the run was persisted could falsely reject a previously-valid output.

### Improvements

- **Unsupported database providers fail fast.** Configuring a not-yet-implemented provider (`sqlite`, `mysql`) now throws synchronously when the database is constructed, instead of erroring later on first use.
- **`/capabilities` reports the running server version.** The response gained a `version` field.

### Breaking Changes

- **The standalone compose stack no longer defaults `CORS_ORIGINS`.** It was `http://localhost:9851`; both compose files now leave it empty. It's optional behind the dashboard image's proxy, but a **cross-origin** dashboard (e.g. a static-host build) must now set `CORS_ORIGINS` on the server explicitly.

- **Dashboard image: the `VITE_AIKI_SERVER_URL` build arg is replaced by the `AIKI_SERVER_UPSTREAM_URL` runtime env.** The prebuilt image no longer bakes the server URL at build time:

  ```bash
  # Before — server URL baked at build time
  docker build --build-arg VITE_AIKI_SERVER_URL=http://your-server:9850 -t dashboard .

  # After — read at container start
  docker run -p 9851:9851 -e AIKI_SERVER_UPSTREAM_URL=http://your-server:9850 ghcr.io/aikirun/dashboard:<version>
  ```

  Building the dashboard for a **static host** still uses `VITE_AIKI_SERVER_URL` at build time — that path is unchanged.

- **Self-hosting pulls published images instead of building from a clone.** Download the compose file from a release (`releases/latest/download/docker-compose.yml`) rather than `git clone`. A build-from-source compose override remains for contributors.

### Documentation

- Rewrote the installation guide's self-hosting section for the image/compose flow, and added workflow-versioning docs.

## 0.31.0

This release centers on a rework of runtime configuration and teardown. Config is now a snapshot-based provider shared by the server, worker, and endpoint; the server runtime tears down through a single abort signal; and `start()`/`spawn()` return synchronously.

### New Features

- **Pluggable runtime config for `@aikirun/worker` and `@aikirun/endpoint`.** Workers and endpoints join the server's config-provider model. The `config` field on `worker()`, `endpoint()`, and `server({ runtime })` accepts either a plain overrides object (deep-merged onto defaults) or a provider:
  - `staticWorkerConfigProvider(overrides?)` — worker config fixed at spawn (`maxConcurrentWorkflowRuns`, `gracefulShutdownTimeoutMs`, `workflowRun.heartbeatIntervalMs`, `workflowRun.spinThresholdMs`).
  - `dynamicWorkerConfigProvider({ initial?, refresh, refreshIntervalMs })` — reloads worker config on a timer so an operator can retune a running worker without redeploying; the loop runs off the teardown signal, and a failed refresh keeps the last-good snapshot with jittered backoff.
  - `staticEndpointConfigProvider(overrides?)` — endpoint config fixed at construction (`signatureMaxAgeMs`, `workflowRun.heartbeatIntervalMs`, `workflowRun.spinThresholdMs`).

### Bug Fixes

- **Server graceful shutdown no longer hangs when `gracefulShutdownTimeoutMs <= 0`.** Previously a non-positive timeout (a value the config accepted) made `runtime.stop()` `await` the daemon drain with no bound, so a busy or stuck daemon could block shutdown indefinitely. A non-positive timeout now means "shut down immediately" — `stop()` returns without waiting. A positive timeout bounds the drain wait and logs a warning if it elapses. (The worker's shutdown already guarded on `> 0` and was not affected.)

### Improvements

- **Single abort signal for runtime teardown.** The server runtime creates one `AbortController` and threads its signal through every daemon, the publisher, the timer-priority queue, and the config refresh loop. `stop()` aborts once and waits (bounded) for everything to unwind via a single `daemonsPromise`. Per-component `AbortController`s, the daemons handle's `stop()`, the config provider's `stop()`, and `Subscriber.close()` are all gone — components clean up off the injected signal. A runtime that fails to start is caught and logged (`"Server runtime failed to start"`) instead of rejecting, and `stop()` is still safe to call.
- **Config is read as a snapshot, not by path.** `ConfigProvider` now exposes a `.config` snapshot and `.scope(key)` narrowing in place of `.get("a.b.c")` string-path reads. Polling daemons re-read `configProvider.config` each cycle, so dynamic changes still take effect live.
- **Server config is deep-merged, not schema-parsed.** `ServerRuntimeConfig` is now a plain interface with a `defaultServerRuntimeConfig` constant; overrides are deep-merged via the new `merge` / `DeepPartial` utilities in `@aikirun/lib/object`. This drops the `arktype` dependency and the `parseServerConfig` step — note that invalid config values are no longer rejected at runtime.
- **Dynamic config no longer blocks startup.** The dynamic provider starts on `initial`/defaults and refreshes in the background; previously the first refresh ran (and was awaited) before startup could complete.
- **Fewer microtasks on the workflow hot path.** `workflowRunHandle()` and `childWorkflowRunHandle()` return synchronously when handed a run record, returning a promise only when a run must be fetched by id. Workflow-run heartbeats moved from a fixed `setInterval` to a self-rescheduling `setTimeout`.
- **Persisted retry strategy takes precedence.** At execution time a workflow run's persisted retry strategy now wins over the strategy defined on the workflow version.

### Breaking Changes

- **`runtime.start()` and `worker.spawn()` are now synchronous.** Both return a handle directly instead of a `Promise`; startup happens in the background and `stop()` stays async.
  ```typescript
  // Before
  const runtimeHandle = await aikiServer.runtime.start();
  const workerHandle = await worker({ workflows: [trialV1] }).spawn(client);

  // After
  const runtimeHandle = aikiServer.runtime.start();
  const workerHandle = worker({ workflows: [trialV1] }).spawn(client);
  ```
- **`server()` moves `cache` and `iam` under a `handler` key.** They were top-level fields; the new `ServerHandlerParams` groups them.
  ```typescript
  // Before
  server({ db, cache, iam, runtime: { ... } });

  // After
  server({ db, handler: { cache, iam }, runtime: { ... } });
  ```
- **`retry` is now a top-level field on task and workflow definitions.** It was nested under `options`; the `TaskDefinitionOptions` and `WorkflowDefinitionOptions` types are removed.
  ```typescript
  // Before
  task({ name, handler, options: { retry: { type: "exponential", maxAttempts: 3, baseDelayMs: 1000 } } });

  // After
  task({ name, handler, retry: { type: "exponential", maxAttempts: 3, baseDelayMs: 1000 } });
  ```
  The same change applies to `workflow.v("1.0.0", { handler, retry: { ... } })`.
- **`worker()` uses `config` instead of `options`.** The `options` field (`WorkerDefinitionOptions`) is replaced by a `config` field accepting either a `WorkerConfigOverrides` object or a config provider (`staticWorkerConfigProvider` / `dynamicWorkerConfigProvider`). Config is no longer overridable at spawn time — only `shards`, `reference`, and the like remain on `WorkerSpawnOptions`.
  ```typescript
  // Before
  worker({ workflows, options: { maxConcurrentWorkflowRuns: 10 } });

  // After
  worker({ workflows, config: { maxConcurrentWorkflowRuns: 10 } });
  ```
- **`endpoint()` uses `config` instead of `options`.** The `options` field (`EndpointOptions`) is replaced by a `config` field accepting either an `EndpointConfigOverrides` object or a config provider (`staticEndpointConfigProvider`).
  ```typescript
  // Before
  endpoint({ workflows, client, secret, options: { signatureMaxAgeMs: 30_000 } });

  // After
  endpoint({ workflows, client, secret, config: { signatureMaxAgeMs: 30_000 } });
  ```
- **Server config provider exports renamed** (and `server({ config })` now also accepts a plain overrides object, not only a provider; the dynamic variant gained an optional `initial`):
  - `ServerConfig` → `ServerRuntimeConfig`
  - `ServerConfigOverrides` → `ServerRuntimeConfigOverrides`
  - `dynamicConfigProvider` → `dynamicRuntimeConfigProvider`
  - `staticConfigProvider` → `staticRuntimeConfigProvider`
- **The `ConfigProvider` contract moved and changed shape.** Import from `@aikirun/lib/config`; `@aikirun/types/infra/config` is removed. `get(path)` is replaced by `config` + `scope(key)`, `CreateConfigProvider` is now synchronous (no `Promise` return), its context carries a required `signal`, and the provider's `stop()` method is gone (teardown is via the signal). Only affects code implementing a custom provider.
- **The `signal` option replaces `abortSignal`** across the public async APIs:
  ```typescript
  // Before
  await delay(1000, { abortSignal });
  await withRetry(fn, strategy, { abortSignal }).run();          // type: WithRetryOptions
  await handle.waitForStatus("completed", { abortSignal });

  // After
  await delay(1000, { signal });
  await withRetry(fn, strategy, { signal }).run();               // type: RetryOptions
  await handle.waitForStatus("completed", { signal });
  ```
  The `WithRetryOptions` type is renamed `RetryOptions`.
- **Custom queue/timer adapters: signal in context, no `close()`.** `SubscriberContext`, `PublisherContext`, and `TimerPriorityQueueContext` now include a required `signal: AbortSignal`. On `Subscriber`, `close()` is removed (clean up off the signal) and `getReadyRuns(limit, options?)` drops its options argument — it is now `getReadyRuns(limit)`, taking its signal from the context.
- **`WorkflowExecutionOptions` renamed to `WorkflowExecutionConfig`** (exported from `@aikirun/workflow`).
- **Task and workflow `Input`/`Output` default to `void`.** The generics previously had no default. A task or workflow that declares no input schema/type can no longer be passed input; declare an input schema or type parameter to accept one.

### Build / Tooling

- **New `@aikirun/testing` package** (in-repo, not yet published). A fake `Client` whose every API endpoint is a mock with queued `.once(request, response)` expectations and a `verify()` that fails on unmet calls, exposed via `withFakeClient`. Includes fishery data factories for schedules, workflow runs, and tasks.
- Added SDK test coverage for tasks, schedules, the replay manifest, the due-timers consumer, the config provider, deep-merge, and `settleWithin`.

## 0.30.0

### New Features

- **Pluggable runtime config for `@aikirun/server`.** The server now takes a config *provider* instead of a fixed options object. Two ship in the box:
  - `staticConfigProvider(overrides?)` — config fixed at startup (the default when none is supplied).
  - `dynamicConfigProvider({ refreshIntervalMs, refresh })` — reloads config on a timer so an operator can retune a running server without redeploying. The first load completes before startup finishes; if a later refresh throws, it's logged and the last-good config is kept.

  Every daemon's interval, batch limit, and imminence threshold, plus `gracefulShutdownTimeoutMs`, are now part of `ServerConfig` and individually tunable. Each polling daemon re-reads its config every cycle, so dynamic changes take effect live.

### Bug Fixes

- **Outbox entries are no longer marked published until delivery is confirmed.** Previously the publish daemon marked every entry `published` the moment `publishReadyRuns` returned, even when delivery silently failed. The run was never lost — the outbox is durable — but a falsely-`published` entry then had to wait for the republish-stale-runs daemon to sweep it up as stale (after `claimMinIdleTimeMs`, default 90s) and resend it. Publishing now returns a structured `PublishResult` (`published` / `deferred` / `failed` / `declined`); only confirmed-`published` entries are marked done, and failed, deferred, and declined runs stay pending for the next publish cycle (default ~1s) rather than waiting for the stale sweep. The republish-stale-runs daemon got the same treatment.
- **Fail-fast Redis adapters.** A shared connection tracker watches each Redis client's lifecycle, including the "socket accepted but never served" case (e.g. a stopped container's still-forwarded port) that previously wedged the client with no events. When the connection is down, `redisPublisher` returns the runs as `failed` instead of silently dropping them, and `redisTimerPriorityQueue.add` returns `{ status: "failed" }` rather than blocking. The connection supervisor also installs a no-op `error` listener so a client without one can't crash the process.
- **The built-in console logger now prints error stack traces.** `Error` values in log metadata now print with their stack trace (falling back to `name: message`) rather than the empty `{}` that `JSON.stringify` produces for an Error's non-enumerable properties. Errors are also logged under a consistent `err` metadata key across the SDK, so a pino-based logger applies its default error serializer.

### Improvements

- **Skip schema validation on the hot path.** Workflow- and task-level input/output validation no longer creates an `async` microtask when no `schema` is defined — the common (schema-less) case now runs synchronously.
- **`TimestampMs` branded type for DB timestamps.** Row timestamps are now a branded `number` (epoch ms) consistently across SDK packages, removing per-row `Date` allocations in hot read paths. No database migration is required — columns still persist as `timestamp with time zone`, and wire/JSON shapes are unchanged.
- **`withRetry` callbacks accept sync results.** `shouldRetryOnResult` and `shouldNotRetryOnError` now accept `boolean | Promise<boolean>` instead of requiring a `Promise`.
- **Docker Compose defaults.** `host.docker.internal` is mapped to `host-gateway` so the default database URL works on Linux too, and `AIKI_SERVER_AUTH_SECRET` is now unset by default so Aiki starts without IAM out of the box.

### Breaking Changes

- **`ServerRuntimeParams.options` replaced by `ServerRuntimeParams.config`.** The `ServerRuntimeOptions` interface (and its `gracefulShutdownTimeoutMs`) is removed; the timeout moved into `ServerConfig`.
  ```typescript
  // Before
  server({
    runtime: { options: { gracefulShutdownTimeoutMs: 10_000 } },
  });

  // After
  import { staticConfigProvider } from "@aikirun/server";

  server({
    runtime: { config: staticConfigProvider({ gracefulShutdownTimeoutMs: 10_000 }) },
  });
  ```
- **`jitterFactor` renamed to `factor`** on the jittered retry strategy (both the SDK type and the server contract schema).
  ```typescript
  // Before
  { type: "jittered", maxAttempts: 5, baseDelayMs: 1000, jitterFactor: 2 }

  // After
  { type: "jittered", maxAttempts: 5, baseDelayMs: 1000, factor: 2 }
  ```
- **Custom queue adapters: result types instead of `void`.** The `@aikirun/types` infra interfaces changed — `Publisher.publishReadyRuns` now returns `PublishResult`, and `TimerPriorityQueue.add` now returns `TimerAddResult` (`{ status: "added" | "failed" }`). Custom adapter implementations must return these.
- **`UnknownWorkflowVersion` type removed — use `AnyWorkflowVersion`.** The workflow registry (`add` / `addMany` / `remove` / `removeMany`) now accepts `AnyWorkflowVersion`.

### Build / Tooling

- Broad unit tests added across `@aikirun/lib` (retry, min-heap, streams, hashing, duration, stable-stringify, object/array utils) and the workflow registry/factory, with tests now running in CI.

### Documentation

- New IAM setup guide (`docs/guides/iam.md`).
- Architecture and core-concepts docs refreshed to the current design; landing page repositioned; conference deck moved out of the web root; `llms.txt` relocated under `docs/`; README overhauled.

## 0.29.2

Maintenance release — no functional or API changes. The only substantive change is the release-tooling fix below; all `@aikirun/*` packages were version-bumped together.

### Build / Tooling

- **Release publishing fails fast.** `release:publish` now aborts on the first failed `bun publish` (`|| exit 1` instead of `|| true`), so a single failing publish no longer leaves a release half-applied — some workspace packages on the registry at the new version while others stay pinned to the previous one.

## 0.29.1

### Bug Fixes

- **Restore type variance on `WorkflowVersion`, `WorkflowBuilder`, and `EventMulticaster`.** Methods declared as arrow-function properties (`name: (...) => T`) are checked with strict function variance, which broke assignability of generic workflow types. Rewrote `start`, `startAsChild`, `getHandleById`, `getHandleByReferenceId`, `send`, and `sendByReferenceId` as method signatures (`name(...): T`) so they're checked bivariantly and accept the same inputs they did before.

### Build / Tooling

- Pin `better-auth` to `1.6.11` via root `overrides` so a transitive `kysely` upgrade can't break the build on fresh installs.

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

## 0.28.0

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

## 0.27.0

### New Features

- **Redis subscriber on per-workflow sorted sets** — `@aikirun/redis` no longer uses Redis Streams with per-workflow consumer groups. The server now publishes ready runs by `ZADD`-ing into one sorted set per workflow (per-shard when shards are in use); workers block on `BZPOPMIN` across the sorted sets they're registered for. No consumer-group bookkeeping, no polling, and a run becomes visible to a worker as soon as the publishing transaction commits.

- **Primary/backup subscriber** — When you configure a custom subscriber (e.g., `@aikirun/redis`), the worker also spawns the HTTP subscriber as a backup. If the primary's `getNextBatch` fails, the worker drains from the backup while a scheduled retry to the primary runs in the background. Automatic when you pass a non-HTTP subscriber; no code changes needed.

- **Discarded task status** — When a workflow run transitions back to `scheduled` with reason `retry`, every task from the prior attempt that is still in `running`, `awaiting_retry`, or `failed` is moved to a new terminal status, `discarded`. Discarded entries appear in the state-transition log (carrying the attempt number they belonged to) but are excluded from `TaskInfo.state`, so a run's "current tasks" only shows tasks for the live attempt.

- **Attempt counter on every state transition** — `StateTransitionBase` now carries `attempt: number`. Workflow-run and task transitions both record the workflow attempt they belong to, which the web UI uses directly to group the timeline.

- **Per-call request cancellation** — `ApiClient` methods now accept `{ signal?: AbortSignal }` as a second argument. In-flight HTTP requests can be cancelled — the worker uses this so a shutdown abort can interrupt a long-running `claimReadyV1` poll.

- **Outbox `claimed` status** — The `workflow_run_outbox` table now has a third status, `claimed`, in addition to `pending` and `published`. Combined with a `claimed_at` timestamp refreshed by worker heartbeats, this lets the server distinguish in-flight runs from abandoned ones: `republishStaleRuns` returns claims whose `claimed_at` exceeds `claimMinIdleTimeMs` to the `published` pool so another worker can pick them up. Schema migration applied automatically.

- **Server heartbeat forwarding from custom subscribers** — When the worker uses a non-HTTP subscriber, it still calls `workflowRun.heartbeatV1` on the server every 30 s per active run. Without this, the server-side outbox heartbeat is never refreshed and `republishStaleRuns` would prematurely steal the claim. Automatic, no configuration required.

- **`db:migrate:debug` script** — Alternative migrate entry-point (`bun db:migrate:debug`) that runs each migration file in its own transaction. Works around `drizzle-kit migrate` wrapping all pending migrations in a single transaction, which Postgres rejects when one migration adds an enum value (`ALTER TYPE … ADD VALUE`) that a later migration references. Same journal format as `drizzle-kit migrate`, so the two paths are interchangeable.

### Breaking Changes

- **`WorkflowRunBatch` renamed to `WorkflowRunMessage`** in `@aikirun/types/subscriber`. Update custom subscriber implementations:
  ```typescript
  // Before
  import type { WorkflowRunBatch } from "@aikirun/types/subscriber";

  // After
  import type { WorkflowRunMessage } from "@aikirun/types/subscriber";
  ```

- **`SubscriberDelayParams` simplified** — Removed `polled`, `at_capacity`, and `heartbeat` variants; only `no_work` and `retry` remain. Capacity backpressure is now handled inside the worker (via a binary latch on free slots) rather than by asking the subscriber for an at-capacity delay. Update custom subscribers:
  ```typescript
  // Before
  case "polled": return delayParams.foundWork ? 0 : intervalMs;
  case "at_capacity": return atCapacityIntervalMs;
  case "heartbeat": return intervalMs;

  // After
  case "no_work": return intervalMs;
  ```

- **`Subscriber.getNextBatch` signature** — Now accepts `(size, options?: { abortSignal?: AbortSignal })`. Implementations should honour the signal so a worker shutdown can promptly interrupt a blocking call (e.g., `BZPOPMIN`).

- **`SubscriberContext.workflows` is now `NonEmptyArray<WorkflowMeta>`** — The worker refuses to start with zero registered workflows, so subscribers can rely on at least one entry.

- **`WorkflowRunClaimReadyRequestV1` shape changed** — Removed `workerId` (was unused) and removed per-workflow `shard`; added top-level optional `shards?: string[]`. Shards are a worker-level filter applied to all of its workflows, not a per-workflow attribute, so the old shape forced custom clients to build the Cartesian product themselves. Affects callers of the contract directly.

- **`@aikirun/lib/address` module removed** — `getWorkerConsumerGroupName` and `getWorkflowStreamName` are no longer needed since the Redis subscriber dropped streams + consumer groups. Remove imports if you used them.

- **`splitArray` renamed to `partitionArray`** in `@aikirun/lib/array` with a richer signature that lets each branch carry a different element type:
  ```typescript
  // Before
  const [matches, rest] = splitArray(items, (item) => predicate(item));

  // After
  const { whenTrue, whenFalse } = partitionArray(items, (item) =>
    predicate(item) ? { meetsCondition: true, item } : { meetsCondition: false, item }
  );
  ```

- **`distributeRoundRobin` removed** from `@aikirun/lib/array` — Round-robin distribution across workflow sorted sets is now done inside a Redis Lua script (`ROUND_ROBIN_ZPOPMIN_SCRIPT`), so the JS helper is dead code.

### Improvements

- **Sub-second timer dispatch via Redis** — Each timer type (sleep elapsed, retry, task retry, scheduled, event/child wait timeout, recurring) has a daemon that scans the DB on a 1 s tick for entries due within `imminenceThresholdMs` (default 3 s). Entries already due are queued and published immediately; the rest go into a single Redis sorted set keyed by `dueAt`-encoded rank. A separate consumer daemon blocks on a signal list paired with the sorted set: when a new entry is added, its `dueAt` is `LPUSH`-ed onto the list, the consumer's `BRPOP` returns, and it pops everything due. Long-tail timers still live in Postgres and only enter the sorted set when they become imminent.

- **Daemons replace `setInterval` crons** — The server's background workers (renamed from `crons/` to `daemons/` internally) now run as a loop with a dynamically computed delay: the next tick fires `intervalMs - durationMs` after the current one finishes, so a slow tick can't overlap with the next one. Replaces the previous `setInterval`-based scheduling that could fire concurrent invocations of the same job under load.

- **Worker shutdown** — `stop()` is now idempotent. It closes subscribers before awaiting the subscriber loop, so blocking calls (e.g., `BZPOPMIN`) unblock by way of the connection closing rather than by polling for the abort signal — the worker no longer hangs at shutdown.

- **Redis keys namespaced under `aiki:`** — All Aiki Redis keys (workflow sorted sets, timer sorted set, signal list) are prefixed so they can't collide with user keys in shared Redis instances.

- **Timer dispatch skips intermediate `scheduled` state** — Due workflow runs now transition directly from `sleeping`/`awaiting_*` to `queued` and are added to the outbox in one step, removing one round-trip of state transition for every timer-driven dispatch.

- **`claimReadyV1` query plan** — The previous query joined the outbox against a derived table built from large `OR` + `CASE WHEN` branches, which the planner's cost grew non-linearly with the number of registered workflows. Replaced with regular joins so plan time scales linearly.

- **`assertRetryAllowed` precheck removed from SDK** — The server is the sole authority on whether a retry is permitted. The SDK no longer rechecks the retry strategy before starting execution; the server's state-machine refusal is what enforces it.

### Web UI

- **Timeline attempt grouping** — Attempt groups are now derived from the `attempt` field on each transition rather than inferred from `scheduled` reason flags. Task transitions are attributed to the workflow attempt that was open when they happened.
- **Discarded task rendering** — Discarded tasks have their own colour and glyph in tables and timelines.
- **Reason shown for `queued` state** — Previously only the `scheduled` status displayed its `reason`; `queued` now does too, since runs can land in `queued` directly when their timer was already due.

## 0.26.0

### Breaking Changes

- **`@aikirun/subscriber-redis` renamed to `@aikirun/redis`** — Shorter package name. Update your install and imports:
  ```typescript
  // Before
  import { redisSubscriber } from "@aikirun/subscriber-redis";

  // After
  import { redisSubscriber } from "@aikirun/redis";
  ```

- **`@aikirun/subscriber-db` renamed to `@aikirun/http`** — Renamed to reflect what it actually does: poll the server's HTTP API. This is an internal package bundled with `@aikirun/worker` — no user code changes needed unless you imported it directly.

- **Transport packages moved** — Internal directory restructure from `sdk/subscriber/` to `sdk/transport/`. No impact on published packages.

## 0.25.0

### Breaking Changes

- **`@aikirun/task` merged into `@aikirun/workflow`** — The `@aikirun/task` package has been removed. Import `task` from `@aikirun/workflow` instead:
  ```typescript
  // Before
  import { task } from "@aikirun/task";
  import { workflow } from "@aikirun/workflow";

  // After
  import { task, workflow } from "@aikirun/workflow";
  ```

  Update your install command:
  ```bash
  # Before
  npm install @aikirun/workflow @aikirun/task @aikirun/client @aikirun/worker

  # After
  npm install @aikirun/workflow @aikirun/client @aikirun/worker
  ```

- **`@aikirun/worker` no longer depends on `@aikirun/client`** — The client is injected at runtime, not a compile-time dependency. No code changes needed — you already pass the client instance when spawning a worker.

## 0.24.1, 0.24.2 & 0.24.3

### Patch Changes

- @aikirun/lib and @aikirun/subscriber-db should not be listed as a depdencies on npm. They are private packages.

## 0.24.0

### New Features

- **`@aikirun/endpoint` package** — Push-based workflow execution for serverless environments. Exposes a Web Standard `(Request) => Promise<Response>` handler that receives workflow runs via signed HTTP requests from the Aiki server. Works with Cloudflare Workers, AWS Lambda, Vercel, and any platform supporting the Fetch API.
  ```typescript
  import { endpoint } from "@aikirun/endpoint";

  const handler = endpoint({
    workflows: [myWorkflowV1],
    client: aikiClient,
    secret: process.env.AIKI_ENDPOINT_SECRET,
  });
  ```

- **Pluggable subscribers** — Work discovery is now a pluggable concern. The client no longer bundles subscriber logic or manages Redis connections. Two subscriber packages are available:
  - `@aikirun/subscriber-db` — DB polling (default, used automatically when no subscriber is specified)
  - `@aikirun/subscriber-redis` — Redis Streams for lower-latency delivery

  Custom subscribers can be implemented via the `CreateSubscriber` type from `@aikirun/types/subscriber`.

### Improvements

- **Worker fallback delay fix** — When the worker falls back from a failed primary subscriber to the DB subscriber, it now uses the fallback subscriber's delay config instead of the primary's.
- **`@aikirun/lib` enforces sub-path imports** — Import from specific sub-paths (e.g., `@aikirun/lib/duration`) instead of the package root.
- **`@aikirun/task` no longer depends on `@aikirun/workflow`** — Reduced coupling between packages.
- **Type restructuring** — `Logger`, error classes (`TaskFailedError`, `NonDeterminismError`, `WorkflowRunRevisionConflictError`, etc.), and `ReplayManifest` moved to dedicated files in `@aikirun/types` for cleaner imports.

### Breaking Changes

- **`client()` no longer accepts `redis` config** — Redis is now configured at the subscriber level, not the client. The client is a lightweight HTTP-only connection.
  ```typescript
  // Before
  const c = client({ url: "...", apiKey: "...", redis: { host: "localhost", port: 6379 } });

  // After
  const c = client({ url: "...", apiKey: "..." });
  ```

- **`client.close()` removed** — The client no longer manages long-lived connections. Remove any `await client.close()` calls.

- **`apiKey` is now required** — No longer falls back to `process.env.AIKI_API_KEY`.

- **`worker.name` removed** — Workers no longer require a `name` param. Worker identity is auto-generated via ULID.
  ```typescript
  // Before
  const w = worker({ name: "order-worker", workflows: [...] });

  // After
  const w = worker({ workflows: [...] });
  ```

- **`subscriber` param on `worker()` changed** — No longer accepts `{ type: "redis" }` or `{ type: "db" }` strategy objects. Pass a `CreateSubscriber` factory function instead.
  ```typescript
  // Before
  const w = worker({ workflows: [...], subscriber: { type: "redis" } });

  // After
  import { redisSubscriber } from "@aikirun/subscriber-redis";
  const w = worker({ workflows: [...], subscriber: redisSubscriber({ host: "localhost", port: 6379 }) });
  ```

- **`opts` renamed to `options`** across all SDK packages — Applies to `worker()`, `workflow.v()`, `task()`, and `schedule()`.
  ```typescript
  // Before
  worker({ workflows: [...], opts: { maxConcurrentWorkflowRuns: 10 } });
  task({ name: "x", handler: fn, opts: { retry: { type: "fixed", maxAttempts: 3 } } });

  // After
  worker({ workflows: [...], options: { maxConcurrentWorkflowRuns: 10 } });
  task({ name: "x", handler: fn, options: { retry: { type: "fixed", maxAttempts: 3 } } });
  ```

- **`trigger` moved from `WorkflowDefinitionOptions` to `WorkflowStartOptions`** — Trigger is a runtime/caller concern, not a definition concern.

- **Re-exports removed from `@aikirun/client`** — Types like `Logger`, `RedisConfig`, `SubscriberStrategy`, `WorkflowRunBatch`, and `ConsoleLogger` are no longer exported from the client package. Import from their new locations:
  - `Logger` → `@aikirun/types/logger`
  - `Subscriber`, `CreateSubscriber` → `@aikirun/types/subscriber`
  - Error classes → `@aikirun/types/workflow-run-error`, `@aikirun/types/task-error`

### Documentation

- Architecture docs reframed around pluggable subscriber abstraction instead of centering on Redis Streams
- Diagrams updated to show both pull (workers) and push (endpoints) delivery models

## 0.23.1

### Improvements

When waiting on run to hit some terminal state, the state transition id is used as a cursor for cutting of history. This cursor should be advanced on every poll so that is cuts of progressively larger chunks of history

## 0.23.0

### New Features

- **Organization invite link flow** — Admins can invite users via email and share a copyable invite link. New `AcceptInvitation` page handles the full flow: unauthenticated users are redirected to sign-in/sign-up with the invite URL preserved, then returned to accept after authentication.
- **Namespace RBAC** — Namespace member operations are now guarded by namespace-level roles instead of requiring org admin:
  - **Admin**: full member management (add, remove, change roles)
  - **Member**: read-only view of the member list
  - **Viewer**: no access to the member panel
  - Org owners/admins retain implicit namespace admin access
- **Namespace soft delete** — Namespaces are soft-deleted instead of hard-deleted. Active sessions are cleared and associated API keys are revoked on deletion.
- **Namespace membership management** — New APIs for managing namespace members: `setMembershipV1`, `removeMembershipV1`, `listMembersV1`, and `listForUserV1`.

### Web UI

- **Organization settings page** — New settings page with tabbed layout (Members / Namespaces) for managing org members, pending invitations, namespace members, and namespace lifecycle.
- **Invite link UX** — Pending invitations show a "Copy Link" button for easy sharing. Invitation acceptance page displays org name, inviter email, and role.
- **Role-aware settings** — API Keys tab is hidden for non-namespace-admins.

### Improvements

- **Organization role in auth context** — `OrganizationSessionRequestContext` now carries `organizationRole`, resolved during authorization rather than at each handler.

## 0.22.0

### New Features

- **`hasTerminatedV1` API endpoint** — New server endpoint that efficiently checks whether a workflow run has reached a terminal state after a given state transition, without fetching the full run object.
- **Organization management UI** — New settings page for managing organizations.

### Improvements

- **`waitForStatus` optimization** — The SDK `handle.waitForStatus()` now uses the new `hasTerminatedV1` endpoint to detect terminal states via state transition history rather than polling the full run state. This fixes a bug where the handle could miss fast state transitions.
- **Cross-origin auth support** — Better Auth now sets `SameSite=none; Secure` cookies and the auth client sends credentials, enabling multi-domain deployments.

## 0.21.0

### Improvements

- **Unit-of-work pattern for database layer** — Restructured the DB layer to use a `Repositories` interface with a built-in `transaction()` method. Services now receive a single `repos` object instead of individual repository instances, and transactional code operates on `txRepos` (scoped repositories) instead of passing raw `tx` parameters through every call.
- **Multi-provider database groundwork** — Moved all Postgres-specific code under `server/infra/db/pg/` (repositories, schema, migrations, provider) and introduced provider-agnostic type interfaces in `server/infra/db/types/`. The `createDatabase()` factory now returns `{ conn, repos, betterAuthSchema }` instead of a raw connection. MySQL and SQLite providers are stubbed but not yet implemented.
- **Auth service decoupled from Postgres** — `createAuthService` now accepts a generic `conn`, `provider`, and `betterAuthSchema` instead of a Postgres-specific `DatabaseConn`, enabling future auth support on other database providers.
- **Extracted `WorkflowRunOutboxStatus` type** — Moved the outbox status type to a shared constants file for reuse.

## 0.20.0

### New Features

- **Workflow name prefix search** — The workflow list API now accepts a `namePrefix` filter for searching workflows by name prefix
- **Filter runs by schedule ID** — Workflow run list API now supports a `scheduleId` filter for finding runs created by a specific schedule
- **Task counts per run** — Workflow run list responses now include per-run `taskCounts` broken down by status (`completed`, `running`, `failed`, `awaiting_retry`)

### Web UI

- **Complete rewrite of the web console** — The dashboard has been rebuilt with a new sidebar navigation layout, dedicated runs list page with filtering and workflow search, dedicated schedules list page, refactored run detail page with separate data/execution/timeline tabs, redesigned API keys page, and dark/light theme support

## 0.19.0

### New Features

- **DB-based work distribution** — New `db` subscriber strategy that uses the database outbox table for work distribution, eliminating the need for Redis as a message broker. Workers poll the server's new `claimReadyV1` and `heartbeatV1` API endpoints to claim and heartbeat workflow runs directly.
- **Redis is now optional** — The server can run without a Redis dependency. When `REDIS_HOST` is not set, the server starts without Redis — API key caching gracefully degrades to DB-only lookups, and the Redis publish/republish crons are skipped.
- **Automatic fallback to DB subscriber** — When using the `redis` subscriber strategy, the worker automatically falls back to the `db` strategy after 2 consecutive Redis failures, improving resilience to Redis outages.
- **Stale run republishing** — New server cron that detects published outbox entries that haven't been claimed within `claimMinIdleTimeMs` and republishes them to Redis streams, preventing runs from getting stuck.

### Breaking Changes

- **Default subscriber strategy changed from `redis` to `db`** — Workers now default to the `db` strategy. To keep using Redis streams:
  ```typescript
  // Before (implicit redis default)
  worker.start();

  // After (explicit redis)
  worker.start({ subscriber: { type: "redis" } });
  ```

## 0.18.0

### New Features

- **Cancellation cascade** — When a workflow run is cancelled, cancellation now automatically cascades to all non-terminal child and grandchild runs. This is implemented as a bundled system workflow (`aiki:cancel-child-runs`) that the SDK registers automatically.
- **Replay manifest & non-determinism detection** — The SDK now tracks a `ReplayManifest` that detects when workflow code diverges from its recorded execution history. A new `NonDeterminismError` is thrown with details about unconsumed manifest entries (task IDs, child workflow run IDs) when replay divergence is detected.
- **Event multicasting by reference ID** — New `sendByReferenceId` method on event multicasters and `multicastEventByReferenceV1` API endpoint allow sending events to workflow runs identified by their reference ID instead of run IDs.
- **Bulk cancel API** — New `cancelByIdsV1` endpoint for cancelling multiple workflow runs by their IDs in a single call.
- **List child runs API** — New `listChildRunsV1` endpoint to list child workflow runs of a parent, with optional status filtering.
- **Workflow source discrimination** — Workflows are now classified as `"user"` or `"system"` source, allowing system workflows (like cancellation cascade) to be separated from user-defined workflows.
- **Unified state transitions** — Workflow run and task state transitions are now stored in a single table discriminated by `type: "workflow_run" | "task"`, replacing the previous separate transition types.

### Web UI

- Dashboard and workflow detail pages now filter by `source: "user"` to hide system workflows.
- Schedule list responses now return `{ schedule, runCount }` items instead of embedding `runCount` in the schedule object.
- Run detail page updated for new queue-based data structures (`taskQueues`, `sleepQueues`, `childWorkflowRunQueues`).

### Improvements

- **CAM queue architecture** — `WorkflowRun` data model restructured from dictionary-based lookups to queue-based structures: `tasks` → `taskQueues`, `sleepsQueue` → `sleepQueues`, `childWorkflowRuns` → `childWorkflowRunQueues`. This supports the Content-Addressed Model where queues are consumed in forward-only fashion.
- **Lightweight state transition responses** — `transitionStateV1` now returns only `{ revision, state, attempts }` instead of the full `WorkflowRun`.
- **`createV1` returns only ID** — `WorkflowRunCreateResponseV1` now returns `{ id }` instead of the full `WorkflowRun` object.
- **Server migrated from in-memory store to Postgres** — The entire server persistence layer has been migrated from in-memory maps to Postgres, including new repositories for sleep queues, event wait queues, child workflow run wait queues, state transitions, and a workflow run outbox.
- **Server crons decomposed** — The monolithic cron module has been split into focused modules: `publish-ready-runs`, `queue-scheduled-runs`, `schedule-retryable-runs`, `schedule-retryable-task-runs`, `schedule-sleep-elapsed-runs`, `schedule-event-wait-timed-out-runs`, `schedule-child-workflow-run-wait-timed-out-runs`, `schedule-recurring-workflows`.
- **ULIDs for all IDs** — All entity IDs (workflow runs, workers, etc.) now use ULIDs instead of UUIDs.
- **Worker graceful shutdown** — `worker.stop()` now awaits the poll loop's abort completion before shutting down, preventing dangling promises.
- **Concurrent task execution** — Task state transitions no longer increment the parent workflow run's revision, enabling `Promise.all([taskA.start(), taskB.start()])` without revision conflicts.
- **Validation before revision check** — State transitions now validate the transition itself before checking revision conflicts, providing better error messages.
- **Child workflow wait queues partitioned by status** — Wait results are now keyed by terminal status (`cancelled`, `completed`, `failed`), fixing a bug where waiting on a different status during replay would return the wrong wait result.
- **API key validation fix** — API key validation no longer incorrectly splits on underscores within the secret portion.

### Bug Fixes

- Fixed `StatusWaitResults` not being partitioned by status, causing incorrect wait results on replay when the awaited status changed.

### Breaking Changes

- **`WorkflowRun` shape restructured** — Queue-based data model:
  ```typescript
  // Before
  run.tasks["address"]             // TaskInfo
  run.sleepsQueue["name"]          // SleepQueue
  run.childWorkflowRuns["address"] // ChildWorkflowRunInfo
  run.address                      // string
  run.options                      // WorkflowStartOptions (always present)

  // After
  run.taskQueues["address"]              // TaskQueue { tasks: TaskInfo[] }
  run.sleepQueues["name"]                // SleepQueue
  run.childWorkflowRunQueues["address"]  // ChildWorkflowRunQueue { childWorkflowRuns: ChildWorkflowRunInfo[] }
  // run.address removed
  run.options                            // WorkflowStartOptions | undefined
  ```

- **`expectedRevision` renamed to `expectedWorkflowRunRevision`** on all task state transition requests.
- **`createV1` response changed** from `{ run: WorkflowRun }` to `{ id: string }`.
- **`transitionStateV1` response changed** from `{ run: WorkflowRun }` to `{ revision, state, attempts }`.
- **`transitionTaskStateV1` response changed** from `{ run, taskId }` to `{ taskInfo: TaskInfo }`.
- **`setTaskStateV1`, `sendEventV1` now return `void`** instead of `{ run: WorkflowRun }`.
- **`TaskStartOptions.reference` removed** — Task reference IDs are no longer supported:
  ```typescript
  // Before
  await myTask.start(run, input, { reference: { id: "my-ref" } });

  // After
  await myTask.start(run, input);  // identity is content-addressed
  ```
- **`WorkflowRunTransition` replaced by `StateTransition`** — Transition types changed:
  ```typescript
  // Before
  import type { WorkflowRunTransition } from "@aikirun/types/workflow-run";
  transition.type === "state"       // WorkflowRunStateTransition
  transition.type === "task_state"  // WorkflowRunTaskStateTransition

  // After
  import type { StateTransition } from "@aikirun/types/state-transition";
  transition.type === "workflow_run"  // WorkflowRunStateTransition
  transition.type === "task"          // TaskStateTransition
  ```
- **`ChildWorkflowRunInfo.statusWaitResults` → `childWorkflowRunWaitQueues`** — Now a record keyed by terminal status.
- **Workflow list/filter APIs require `source` field**:
  ```typescript
  // Before
  client.workflow.listV1({});

  // After
  client.workflow.listV1({ source: "user" });
  ```
- **`WorkflowFilter` restructured** — Now a discriminated union requiring `source`:
  ```typescript
  // Before
  { name: "my-workflow", versionId: "1.0.0", referenceId: "ref" }

  // After
  { name: "my-workflow", source: "user", versionId: "1.0.0", referenceId: "ref" }
  ```
- **Sort `field` removed from list endpoints** — `sort.field` property removed from `listV1` and `listTransitionsV1`; only `sort.order` remains.
- **Schedule list response changed** — From `{ schedules: Schedule[] }` to `{ schedules: { schedule: Schedule; runCount: number }[] }`. `runCount` removed from the `Schedule` type itself.
- **Schedule `pauseV1` and `resumeV1` now return `void`** instead of the schedule object.

## 0.17.0

### New Features

- **Authentication and Authorization** - Full authentication system with better-auth integration
  - Sign in/sign up flows with email/password
  - Session-based authentication for the web dashboard
  - API key authentication for SDK clients
  - Organization and namespace multi-tenancy support

- **API Key Management** - Create, list, and revoke API keys from the web dashboard
  - API keys are scoped to namespaces
  - Keys are hashed for secure storage

- **Organization and Namespace Support** - Multi-tenant architecture
  - Create and switch between organizations
  - Create namespaces within organizations
  - Onboarding flow for new users to create organization and namespace

- **Database Persistence Layer** - PostgreSQL schema for Aiki core entities
  - Workflow, workflow run, task, schedule persistence
  - Sleep queue and event wait queue tables
  - State transition tracking tables
  - Drizzle ORM with migrations

### Web UI

- Added sign in and sign up pages
- Added organization and namespace selectors in header
- Added user menu with sign out
- Added settings page with API key management
- Added onboarding flow for new users
- Protected routes require authentication

### Improvements

- SDK client now requires API key authentication (via `apiKey` param or `AIKI_API_KEY` env variable)
- SDK client URL path changed to include `/api` prefix
- Added database migration commands to root package.json (`db:generate`, `db:migrate`, `db:push`)

### Breaking Changes

- **SDK client requires API key** - Update your client initialization:
  ```typescript
  // Before
  const aikiClient = client({
    url: "http://localhost:9850",
    redis: { host: "localhost", port: 6379 },
  });

  // After
  const aikiClient = client({
    url: "http://localhost:9850",
    apiKey: "your-api-key", // or set AIKI_API_KEY env variable
    redis: { host: "localhost", port: 6379 },
  });
  ```

- **`OverlapPolicy` renamed to `ScheduleOverlapPolicy`** - Update your imports:
  ```typescript
  // Before
  import type { OverlapPolicy } from "@aikirun/types/schedule";

  // After
  import type { ScheduleOverlapPolicy } from "@aikirun/types/schedule";
  ```

- **`eventsQueue` renamed to `eventWaitQueues`** in `WorkflowRun` type
- **`EventState` renamed to `EventWaitState`** - Types for event waiting have been renamed for clarity
- **`EventQueue` renamed to `EventWaitQueue`**
- **`WorkflowFailureCause` renamed to `WorkflowRunFailureCause`**
- **Workflow run list filter `runId` renamed to `id`**

## 0.16.0

### Breaking Changes

- **Schedule `name` property removed** - Schedules no longer have a `name` property. Use `reference.id` for explicit identity instead
- **`ScheduleHandle.name` removed** - The handle returned from `activate()` no longer has a `name` property
- **`getByNameV1` replaced with `getByReferenceIdV1`** - Update API calls accordingly
- **`WorkflowRunConflictError` renamed to `WorkflowRunRevisionConflictError`**

### New Features

- **Schedule reference IDs with conflict policies** - Assign explicit reference IDs to schedules with configurable conflict behavior (`"upsert"` or `"error"`)
- **Workflow run conflict detection** - When starting workflows with reference IDs, conflicts are now detected by comparing input hashes. Same reference + same input returns existing run; same reference + different input + `"error"` policy throws an error
- **`inputHash` added to `WorkflowRun`** - Workflow runs now include an `inputHash` field for conflict detection

### Web UI

- Schedule table improvements (ID/Reference ID columns, filters, removed Name column)
- Fixed "Clear All" for schedule status filter

## 0.15.0

### New Features

- **Scheduled Workflows** - Run workflows on a schedule using cron expressions or intervals. Define schedules with `schedule()` and activate them with `schedule.activate()`.

### Web UI

- Added Schedules tab to the dashboard for viewing and managing scheduled workflows
- Added status filtering for schedules (active/paused/deleted)
- Filters now persist in the URL, allowing browser back/forward navigation to restore filter state

### Improvements

- Separated workflow, task, and worker definition options from runtime options for better clarity
  - `TaskOptions` → `TaskDefinitionOptions` + `TaskStartOptions`
  - `WorkflowOptions` → `WorkflowDefinitionOptions` + `WorkflowStartOptions`

### Breaking Changes

- **`TaskPath` renamed to `TaskAddress`** - Update type imports if used directly
- **`WorkflowRunPath` renamed to `WorkflowRunAddress`** - Update type imports if used directly
- **`onConflict` renamed to `conflictPolicy`** - Update your code:
  ```typescript
  // Before
  task.with().opt("reference.onConflict", "return_existing").start(run, input);

  // After
  task.with().opt("reference.conflictPolicy", "return_existing").start(run, input);
  ```

## 0.14.0

### Bug Fixes

- Fixed infinite task retry bug where tasks would retry indefinitely
- Fixed `waitForStatus` incorrectly treating non-expected terminal statuses as expected

### Web UI

- Added Run ID and Reference ID filters for workflow runs
- Added copy buttons for IDs throughout the UI
- Made status and version filters multi-select dropdowns
- Added filter debounce for smoother UX
- Added date dividers to timeline when date changes between transitions
- Added attempt dividers to timeline (combined with date when both change)
- Show task name and truncated ID in error section when workflow fails due to task
- Added distinct orange styling for task `awaiting_retry` status in timeline
- Removed redundant "Task:" prefix from timeline entries
- Fixed scroll-to-top issue when filtering
- Added error state handling for failed filter requests
- Made live indicator pulse more visible
- Removed Dashboard heading and Refresh button (use browser refresh)

### API Improvements

- Added `runId` filter to workflow run list API
- Added `referenceId` filter to workflow run list API
- Workflow run list now returns `referenceId` in response

## 0.13.0

### Breaking Changes

- Client creation is lazy under the hood, no need to may the factory function async

## 0.12.0

### Web UI
- New React-based web UI for monitoring workflows
- View workflow runs, statuses, and details
- Docker support with nginx for production deployment

### Workflow API
- `workflow.listV1` - List all workflows with run counts
- `workflow.listVersionsV1` - List versions for a workflow
- `workflow.getStatsV1` - Get run statistics by status

### Docker
- Moved server Dockerfile to `server/Dockerfile`
- Added `web/Dockerfile` for the web dashboard
- Docker Compose now starts both server and web services

### Breaking Changes
- Renamed environment variables:
  - `AIKI_PORT` → `AIKI_SERVER_PORT`
  - `AIKI_HOST` → `AIKI_SERVER_HOST`
- Default server port changed to `9850`
- Default web port is `9851`

### Other
- Added `name` and `versionId` to child workflow run info
- Added Aiki logo assets

## 0.11.2

### Fixes

- On client stop, disconnect from redis immediately, no need to wait for pending responses

## 0.11.1

### Fixes

- Fixed bug in set value by path function

## 0.11.0

### Breaking Changes

- **Renamed `getHandle` to `getHandleById`** on workflow versions for clarity and consistency with the new reference ID method

### New Features

- **Added `getHandleByReferenceId` method** to workflow versions, allowing retrieval of workflow run handles using a reference ID instead of the run ID

### Fixes

- Fixed retry strategy schema validation

## 0.10.1

### Patch Changes

Workflow, Task and Event schemas now work with any validation library that implements [Standard Schema](https://standardschema.dev/) (Zod, Valibot, ArkType, etc.).

## 0.10.0

### Schema Validation Migration

Migrated schema validation from Zod to ArkType across both server and client SDK. ArkType handles nested discriminated unions better than Zod, which was causing issues with complex workflow state types.

### Redis Streams Reliability Fix

Fixed a critical bug where concurrent blocking `XREADGROUP` requests caused messages to get stuck in the Pending Entries List (PEL). The worker now sends blocking requests sequentially instead of concurrently, preventing message loss during workflow execution.

Also changed default `claimMinIdleTimeMs` from 180 seconds to 90 seconds for faster recovery of stuck messages.

### Void Type Support

Added support for `void` types across the SDK:
- Workflow input and output can now be `void`
- Task input and output can now be `void`
- Event data can now be `void`

This allows for cleaner type definitions when workflows, tasks, or events don't require data.

### Console Logger Improvements

- Added configurable log level
- Pretty logs are now enabled by default

### Breaking Changes

- Removed `startAt` trigger strategy to avoid potential clock skew issues between client and server. Use `delayed` trigger strategy instead.
- Timestamps are now validated to be positive numbers

### API Improvements

- User-exposed methods no longer require branded types, making the API easier to use

## 0.9.0

### Breaking Changes

- Renamed `contextFactory` to `createContext` in client configuration
- Renamed subscriber type `redis_streams` to `redis`

### New Features

- Schema validation for cached results: when a schema is provided, cached task/child workflow outputs are validated against the schema on replay. If the cached shape doesn't match, the workflow fails immediately.

## 0.8.0

### Breaking Changes

- Renamed `idempotencyKey` to `reference.id` for workflows, tasks and events
- Renamed `workflowId` to `name` on WorkflowVersion and WorkflowRun
- Renamed `taskId` to `taskName`
- Renamed `sleepId` to `sleepName`
- Renamed `eventId` to `eventName`
- Renamed `workerId` to `workerName`. Actual worker ID is now auto-generated UUID
- Renamed `shardKey` to `shard`
- Changed workflow handler signature: order is now `(run, input, context)` instead of `(input, run, context)`
- Separated sleep name and duration into separate args
- Workflow run paths are now internal (only workflow run IDs exposed to users)
- Task paths are now internal (task IDs generated on first run)
- Workflow run IDs now use UUIDs
- `tasksState` renamed to `tasks` (now stores TaskInfo with id, name, state, inputHash)
- `sleepsState` renamed to `sleepsQueue`
- `childWorkflowRunPath` renamed to `childWorkflowRunId`

### New Features

- Smart sleep duration handling during replay: if code is refactored to increase sleep duration, the workflow sleeps only the remaining delta; if duration is decreased, it returns immediately
- Added optional input/output schema validation for tasks and workflows (validation errors fail the workflow)
- Builder pattern for event options (`.with().opt()`)
- When event data is void, `data` param not required for `send` method
- Workers can have `reference.id` for external correlation
- `onConflict` policy for reference ID conflicts on workflows and tasks (`"error"` | `"return_existing"`)
- Added `awake_early` scheduled reason to differentiate between duration expiry and manual awakes
- Tasks and child workflows now track `inputHash`
- Added ID to state transitions
- Added `WorkflowRunConflictError` class for conflict handling

### Bug Fixes & Improvements

- When workers hit conflicts during workflow execution, they now leave the message for another worker to retry
- Sleep/wait for event/childWorkflow conflict errors are now converted to suspended errors.
- State transition conflict errors skip retry
- Fixed bug where worker name was passed to message queue instead of ID

### Internal

- Moved shared schema to separate file to prevent circular import
- Added logging improvements (task name in logs, various debug logs)
- Created `getTaskPath`, `getWorkflowRunPath` helper functions
- Created branded types for `WorkerName` and `WorkerId`
- Added `hashInput` helper function
- Renamed "error" module to "serializable"
- Ensured task outputs and event data are serializable
- Removed `TaskStateNone` and `SleepStateNone`
- Changed default server port

## 0.7.0

### Child Workflow Runs

Workflows can now spawn and manage child workflows using `workflow.startAsChild()`.

- `waitForStatus()` waits for child to reach a terminal status
- Optional timeout support with `{ timeout: { minutes: 5 } }`
- Race condition prevention: atomic check when transitioning to `awaiting_child_workflow`

### Event Multicasters

Added event multicasters for broadcasting events to multiple workflow runs.

### Handle Improvements

- `waitForStatus()` renamed from `waitForState()` for clarity
- `awake()` method added to wake sleeping workflows
- Event data type defaults to `undefined` when not specified

### Workflow Output Validation

Workflow input and output are now verified at compile time to be serializable.

### Handler Return Type Inference

Handler return type can now be auto-inferred from the handler body - no need to annotate.

### Bug Fixes

- Fixed race condition where events arriving between workflow start and event wait were missed
- Fixed incorrect condition negation when waiting for child workflow status
- Fixed `WorkflowRunFailedError` not precluding further retries
- Disallowed state transitions from awaiting states to paused (resuming from paused would skip the awaited operation)

## 0.6.0

### Minor Changes

- Add workflow events for external signal handling
  * Define type-safe events on workflow versions with optional schema validation
  * Wait for events inside workflows with optional timeout
  * Send events via typed handles (from start() or getHandle())
  * Queue-based model with idempotency key support for deduplication
- New `awaiting_retry` state for tasks when retry delay exceeds spin threshold
- Workers now send time deltas instead of absolute timestamps to resolve clock skew
- Fix assertRetryAllowed to transition workflow to failed state before throwing
- Fix clock skew in task retry: suspend on Redis redelivery, let server schedule

## 0.5.3

### Patch Changes

- Merge per-package changelogs into one changelog

## 0.5.2

### Patch Changes

- Add missing entrypoint for sleep types

## 0.5.1

### Patch Changes

- Add missing entry point in types package

## 0.5.0

### Minor Changes

- Depend only on latest aiki packages

## 0.4.0

### Minor Changes

- Do not depend on older versions of aiki packages

## 0.3.3

### Patch Changes

- No need to mark @aikirun/lib as a dev dependency since it is bundled at build time

## 0.3.2

### Patch Changes

- Mark @aikirun/lib as a dev dependency

## 0.3.1

### Patch Changes

- Use `bun publish` instead of `changeset publish`

## 0.3.0

### New Features

- Add durable sleep to workflow runs
- Add workflow run cancellation
- Implement workflow pause and resume
- Define state machine for workflow and task state transitions

### Breaking Changes

- Rename `worker.start()` to `worker.spawn()`
- Rename `runCtx` to `run`
- Rename `exec` to `handler`
- Rename `WorkflowSleepingError` to `WorkflowSuspendedError`
- Prefix API request/response types with their namespace

### Improvements

- Unify `state-handle` and `run-handle` for interacting with running workflows
- State transitions now return updated state, reducing round trips
- Add reason field to queued state, to distinguish workflows waking up vs being retried
- Only new workflow runs and retries increment the attempt counter
- Remove Redis from docker-compose (users bring their own infrastructure)

## 0.2.0

### Breaking Changes

**API Renames**

- `task.name` → `task.id`
- `workflow.name` → `workflow.id`
- `workflowVersionId` spelled out verbosely

**Options API**

- Removed `withOpts()` method from tasks, workflows, and workers
- Use inline `opts` for static configuration:
  ```typescript
  task({ id: "send-email", exec, opts: { retry: { maxAttempts: 3 } } });
  ```
- Use `with().opt().start()` for runtime variations:
  ```typescript
  task.with().opt("idempotencyKey", "key").start(run, input);
  ```

**Worker API**

- `workflows` moved to worker params (required at definition time)
- `id` is now mandatory
- Client passed to `start()` instead of `worker()`:
  ```typescript
  const w = worker({ id: "w1", workflows: [v1] });
  await w.start(client);
  ```
- Workers subscribe to specific workflow versions (streams scoped to `workflow/{id}/{version}`)

**Package Structure**

- `@aikirun/lib` is now internal (not published)
- Public types moved to `@aikirun/types`

## 0.1.13

### Patch Changes

- Update documentation and build tooling
  - Migrate from Deno/JSR to Bun/npm
  - Update installation instructions to use npm
  - Fix TypeScript build configuration

## 0.1.10

### Patch Changes

- Remove @aikirun/task dependency on @aikirun/client

## 0.1.0 - 2025-11-09

### Added

Initial release of all Aiki packages:

**@aikirun/types** - Core type definitions for:
- Workflow and task execution
- Workflow run states and transitions
- Trigger strategies (immediate, delayed)
- Retry configuration
- Event handling
- Client interfaces

**@aikirun/lib** - Foundation utilities including:
- Duration API with human-readable time syntax (days, hours, minutes, seconds)
- Retry strategies (never, fixed, exponential, jittered)
- Async helpers (delay, fireAndForget)
- Process signal handling for graceful shutdown
- JSON serialization utilities
- Array and object utilities
- Polling with adaptive backoff

**@aikirun/workflow** - Workflow SDK with:
- Workflow definition and versioning
- Multiple workflow versions running simultaneously
- Task execution coordination
- Structured logging
- Type-safe workflow execution

**@aikirun/task** - Task SDK for:
- Task definition
- Automatic retry with multiple strategies
- Idempotency keys for deduplication
- Structured error handling
- Task execution within workflows

**@aikirun/client** - Client SDK for:
- Connecting to Aiki server
- Starting workflow executions
- Polling workflow state changes
- Type-safe input/output handling
- Custom logger support

**@aikirun/worker** - Worker SDK for:
- Executing workflows and tasks
- Horizontal scaling across multiple workers
- Durable state management and recovery
- Redis Streams for message distribution
- Graceful shutdown handling
- Polling with adaptive backoff
