# @aikirun/types

Core type definitions for Aiki durable execution engine.

This package provides the foundational TypeScript types used throughout the Aiki ecosystem. It is typically not used
directly, but imported by other Aiki packages.

## Installation

```bash
deno add jsr:@aikirun/types
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
import type { WorkflowOptions } from "@aikirun/types/workflow-run";
import type { TriggerStrategy } from "@aikirun/types/trigger";
```

## Related Packages

- [@aikirun/lib](https://jsr.io/@aikirun/lib) - Foundation utilities
- [@aikirun/client](https://jsr.io/@aikirun/client) - Client SDK
- [@aikirun/workflow](https://jsr.io/@aikirun/workflow) - Workflow SDK
- [@aikirun/task](https://jsr.io/@aikirun/task) - Task SDK
- [@aikirun/worker](https://jsr.io/@aikirun/worker) - Worker SDK

## License

Apache-2.0
