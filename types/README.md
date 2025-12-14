# @aikirun/types

Core type definitions for Aiki durable execution platform.

This package provides the foundational TypeScript types used throughout the Aiki ecosystem. It is typically not used
directly, but imported by other Aiki packages.

## Installation

```bash
npm install @aikirun/types
```

## Exports

- `/client` - Client configuration and API types
- `/workflow` - Workflow definition types
- `/workflow-run` - Workflow execution state types
- `/workflow-run-api` - API contract types
- `/task` - Task definition and state types
- `/trigger` - Trigger strategy types
- `/duration` - Duration types
- `/retry` - Retry strategy types
- `/error` - Serializable error types

## Usage

These types are primarily used by other Aiki packages:

```typescript
import type { WorkflowOptions } from "@aikirun/types/workflow-run";
import type { TriggerStrategy } from "@aikirun/types/trigger";
```

## Related Packages

- [@aikirun/client](https://www.npmjs.com/package/@aikirun/client) - Client SDK
- [@aikirun/workflow](https://www.npmjs.com/package/@aikirun/workflow) - Workflow SDK
- [@aikirun/task](https://www.npmjs.com/package/@aikirun/task) - Task SDK
- [@aikirun/worker](https://www.npmjs.com/package/@aikirun/worker) - Worker SDK

## License

Apache-2.0
