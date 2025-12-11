# @aikirun/task

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
