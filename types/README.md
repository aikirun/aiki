# @aiki/types

Core type definitions for Aiki durable execution engine.

This package provides the foundational TypeScript types used throughout the Aiki ecosystem. It is typically not used directly, but imported by other Aiki packages.

## Installation

```bash
deno add jsr:@aiki/types
```

## Exports

### `/client`
Types for the client package, including client configuration and response types.

### `/trigger`
Trigger strategy types for controlling when workflows should execute:
- `immediate` - Execute immediately
- `delayed` - Execute after a duration
- `startAt` - Execute at a specific timestamp

### `/workflow`
Workflow definition types and interfaces.

### `/task`
Task definition and execution types.

### `/workflow-run`
Runtime state and execution types for workflow runs:
- Workflow run states (scheduled, queued, running, sleeping, etc.)
- Task execution states
- Child workflow execution states
- Event waiting conditions

### `/workflow-run-api`
API contract types for workflow run operations.

### `/serializable`
Types for serializable error handling.

## Usage

These types are primarily used by other Aiki packages:

```typescript
import type { WorkflowOptions } from "@aiki/types/workflow-run";
import type { TriggerStrategy } from "@aiki/types/trigger";
```

## Related Packages

- [@aiki/lib](https://jsr.io/@aiki/lib) - Foundation utilities
- [@aiki/client](https://jsr.io/@aiki/client) - Client SDK
- [@aiki/workflow](https://jsr.io/@aiki/workflow) - Workflow SDK
- [@aiki/task](https://jsr.io/@aiki/task) - Task SDK
- [@aiki/worker](https://jsr.io/@aiki/worker) - Worker SDK

## License

Apache-2.0
