# @aikirun/worker

## 0.1.13

### Patch Changes

- 23c9175: Update documentation and build tooling

  - Migrate from Deno/JSR to Bun/npm
  - Update installation instructions to use npm
  - Fix TypeScript build configuration

- Updated dependencies [23c9175]
  - @aikirun/lib@0.1.13
  - @aikirun/client@0.1.13
  - @aikirun/workflow@0.1.13
  - @aikirun/types@0.1.13

## 0.1.0 - 2025-11-09

### Added

- Initial release of @aikirun/worker - Worker SDK for:
  - Executing workflows and tasks
  - Horizontal scaling across multiple workers
  - Durable state management and recovery
  - Redis Streams for message distribution
  - Graceful shutdown handling
  - Polling with adaptive backoff
