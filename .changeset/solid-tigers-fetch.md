---
"@aikirun/workflow": minor
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
"@aikirun/types": minor
---

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
