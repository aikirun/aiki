# @aikirun/lib

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
  - @aikirun/types@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [dc82021]
  - @aikirun/types@0.2.0

## 0.1.13

### Patch Changes

- 23c9175: Update documentation and build tooling

  - Migrate from Deno/JSR to Bun/npm
  - Update installation instructions to use npm
  - Fix TypeScript build configuration

## 0.1.0 - 2025-11-09

### Added

- Initial release of @aikirun/lib - Foundation utilities including:
  - Duration API with human-readable time syntax (days, hours, minutes, seconds)
  - Retry strategies (never, fixed, exponential, jittered)
  - Async helpers (delay, fireAndForget)
  - Process signal handling for graceful shutdown
  - JSON serialization utilities
  - Array and object utilities
  - Polling with adaptive backoff
