# @aikirun/task

## 0.4.0

### Minor Changes

- 01ccb2b: Do not depend on older versions of aiki packages

### Patch Changes

- Updated dependencies [01ccb2b]
  - @aikirun/workflow@0.4.0
  - @aikirun/types@0.4.0

## 0.3.3

### Patch Changes

- 3441f8d: no need to mark @aikirun/lib as a dev dependency since it is bundled as build time
- Updated dependencies [3441f8d]
  - @aikirun/workflow@0.3.3
  - @aikirun/types@0.3.3

## 0.3.2

### Patch Changes

- 6e6d4f1: Mark @aikirun/lib as a dev dependency
- Updated dependencies [6e6d4f1]
  - @aikirun/workflow@0.3.2
  - @aikirun/types@0.3.2

## 0.3.1

### Patch Changes

- 6acc070: Use `bun publish` instead of `changeset publish`
- Updated dependencies [6acc070]
  - @aikirun/lib@0.3.1
  - @aikirun/workflow@0.3.1
  - @aikirun/types@0.3.1

## 0.3.0

### Minor Changes

- c8b1d37: ### New Features

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

### Patch Changes

- Updated dependencies [c8b1d37]
  - @aikirun/lib@0.3.0
  - @aikirun/workflow@0.3.0
  - @aikirun/types@0.3.0

## 0.2.0

### Minor Changes

- dc82021: ### Breaking Changes

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

### Patch Changes

- Updated dependencies [dc82021]
  - @aikirun/workflow@0.2.0
  - @aikirun/types@0.2.0
  - @aikirun/lib@0.2.0

## 0.1.13

### Patch Changes

- 23c9175: Update documentation and build tooling

  - Migrate from Deno/JSR to Bun/npm
  - Update installation instructions to use npm
  - Fix TypeScript build configuration

- Updated dependencies [23c9175]
  - @aikirun/lib@0.1.13
  - @aikirun/workflow@0.1.13
  - @aikirun/types@0.1.13

## 0.1.10 - 2025-11-10

### Changed

- Remove @aikirun/task dependency on @aikirun/client

## 0.1.0 - 2025-11-09

### Added

- Initial release of @aikirun/task - Task SDK for:
  - Deterministic task definition
  - Automatic retry with multiple strategies
  - Idempotency keys for deduplication
  - Structured error handling
  - Task execution within workflows
