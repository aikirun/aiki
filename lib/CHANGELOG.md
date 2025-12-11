# @aikirun/lib

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
