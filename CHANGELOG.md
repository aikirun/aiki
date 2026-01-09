# Changelog

All notable changes to Aiki packages are documented here. All `@aikirun/*` packages share the same version number and are released together.

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
