# @aikirun/task

Task SDK for Aiki durable execution platform.

## Installation

```bash
npm install @aikirun/task
```

## Quick Start

```typescript
import { task } from "@aikirun/task";

export const sendEmail = task({
	name: "send-email",
	async handler(input: { email: string; message: string }) {
		return emailService.send(input.email, input.message);
	},
});
```

Execute in a workflow:

```typescript
import { workflow } from "@aikirun/workflow";

export const notificationWorkflow = workflow({ name: "notifications" });

export const notificationWorkflowV1 = notificationWorkflow.v("1.0.0", {
	async handler(run, input: { email: string }) {
		await sendEmail.start(run, {
			email: input.email,
			message: "Welcome!",
		});
		return { sent: true };
	},
});
```

## Features

- **Automatic Retries** - Configurable retry strategies (fixed, exponential, jittered)
- **Idempotent Execution** - Same input returns cached result
- **Reference IDs** - Custom identifiers for deduplication
- **Schema Validation** - Validate input and output at runtime
- **Type Safety** - Full TypeScript support

## Documentation

For comprehensive documentation including retry strategies, schema validation, and best practices, see the [Tasks Guide](https://aiki.run/docs/core-concepts/tasks).

## Related Packages

- [@aikirun/workflow](https://www.npmjs.com/package/@aikirun/workflow) - Define workflows
- [@aikirun/client](https://www.npmjs.com/package/@aikirun/client) - Start workflows
- [@aikirun/worker](https://www.npmjs.com/package/@aikirun/worker) - Execute workflows

## License

Apache-2.0
