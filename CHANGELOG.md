# Changelog

All notable changes to Aiki packages are documented here. All `@aikirun/*` packages share the same version number and are released together.

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
