# Changelog

All notable changes to the Aiki SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.9] - 2025-11-10
- Remove @aikirun/task dependency on @aikirun/client

## [0.1.0] - 2025-11-09

### Added
- Initial release of Aiki SDK - a durable execution engine
- **@aikirun/lib** - Foundation utilities including:
  - Duration API with human-readable time syntax (days, hours, minutes, seconds)
  - Retry strategies (never, fixed, exponential, jittered)
  - Async helpers (delay, fireAndForget)
  - Process signal handling for graceful shutdown
  - JSON serialization utilities
  - Array and object utilities
  - Polling with adaptive backoff
- **@aikirun/types** - Core type definitions for:
  - Workflow and task execution
  - Workflow run states and transitions
  - Trigger strategies (immediate, delayed, startAt)
  - Retry configuration
  - Event handling
  - Client interfaces
- **@aikirun/workflow** - Workflow SDK with:
  - Workflow definition and versioning
  - Multiple workflow versions running simultaneously
  - Task execution coordination
  - Durable sleep functionality
  - Structured logging
  - Type-safe workflow execution
- **@aikirun/client** - Client SDK for:
  - Connecting to Aiki server
  - Starting workflow executions
  - Polling workflow state changes
  - Type-safe input/output handling
  - Custom logger support
- **@aikirun/task** - Task SDK for:
  - Deterministic task definition
  - Automatic retry with multiple strategies
  - Idempotency keys for deduplication
  - Structured error handling
  - Task execution within workflows
- **@aikirun/worker** - Worker SDK for:
  - Executing workflows and tasks
  - Horizontal scaling across multiple workers
  - Durable state management and recovery
  - Redis Streams for message distribution
  - Graceful shutdown handling
  - Polling with adaptive backoff
- Comprehensive documentation:
  - Package READMEs with examples
  - JSDoc comments on all major exports
- Release automation:
  - `deno task release` - Complete release workflow (sync, publish, verify, tag)
  - `deno task publish-jsr` - Sync versions and publish to JSR
  - `deno task post-publish` - Verify packages and create git tag
  - `deno task sync-version` - Synchronize versions across monorepo

### Documentation
- README.md for each package
- JSDoc comments for main SDK functions
- CHANGELOG.md (this file)

[unreleased]: https://github.com/aikirun/aiki/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aikirun/aiki/releases/tag/v0.1.0
