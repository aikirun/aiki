# @aikirun/server

## 0.3.1

### Patch Changes

- 6acc070: Use `bun publish` instead of `changeset publish`
- Updated dependencies [6acc070]
  - @aikirun/lib@0.3.1
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
  - @aikirun/types@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [dc82021]
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
  - @aikirun/types@0.1.13

## 0.1.0 - 2025-11-09

### Added

- Initial release of @aikirun/server
