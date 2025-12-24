# Changelog

All notable changes to Aiki packages are documented here. All `@aikirun/*` packages share the same version number and are released together.

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
- Trigger strategies (immediate, delayed, startAt)
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
