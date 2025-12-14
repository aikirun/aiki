# @aikirun/task

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
