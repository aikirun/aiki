# @aikirun/task

Task SDK for Aiki durable execution platform - define reliable tasks with automatic retries, idempotency, and error
handling.

## Installation

```bash
npm install @aikirun/task
```

## Quick Start

### Define a Simple Task

```typescript
import { task } from "@aikirun/task";

export const sendVerificationEmail = task({
	name: "send-verification",
	async handler(input: { email: string }) {
		return emailService.sendVerification(input.email);
	},
});
```

### Task with Retry Configuration

```typescript
export const ringAlarm = task({
	name: "ring-alarm",
	handler(input: { song: string }) {
		return Promise.resolve(audioService.play(input.song));
	},
	opts: {
		retry: {
			type: "fixed",
			maxAttempts: 3,
			delayMs: 1000,
		},
	},
});
```

### Execute Task in a Workflow

```typescript
import { workflow } from "@aikirun/workflow";

export const morningWorkflow = workflow({ id: "morning-routine" });

export const morningWorkflowV1 = morningWorkflow.v("1.0.0", {
	async handler(run, input) {
		const result = await ringAlarm.start(run, { song: "alarm.mp3" });
		console.log("Task completed:", result);
	},
});
```

## Features

- **Idempotent Execution** - Tasks can be safely retried without unintended side effects
- **Automatic Retries** - Multiple retry strategies (fixed, exponential, jittered)
- **Reference IDs** - Custom identifiers for tracking and deduplication
- **Error Handling** - Structured error information with recovery strategies
- **State Tracking** - Task execution state persists across failures
- **Type Safety** - Full TypeScript support with input/output types

## Task Configuration

```typescript
interface TaskOptions {
	retry?: RetryStrategy;
	reference?: { id: string; onConflict?: "error" | "return_existing" };
}
```

### Retry Strategies

#### Never Retry

```typescript
opts: {
  retry: { type: "never" },
}
```

#### Fixed Delay

```typescript
opts: {
  retry: {
    type: "fixed",
    maxAttempts: 3,
    delayMs: 1000,
  },
}
```

#### Exponential Backoff

```typescript
opts: {
  retry: {
    type: "exponential",
    maxAttempts: 5,
    baseDelayMs: 1000,
    factor: 2,
    maxDelayMs: 30000,
  },
}
```

#### Jittered Exponential

```typescript
opts: {
  retry: {
    type: "jittered",
    maxAttempts: 5,
    baseDelayMs: 1000,
    jitterFactor: 0.1,
    maxDelayMs: 30000,
  },
}
```

## Execution Context

Tasks are executed within a workflow's execution context. Logging happens in the workflow:

```typescript
export const processPayment = task({
	name: "process-payment",
	async handler(input: { amount: number }) {
		return { success: true, transactionId: "tx_123" };
	},
});

export const paymentWorkflowV1 = paymentWorkflow.v("1.0.0", {
	async handler(run, input) {
		run.logger.info("Processing payment", { amount: input.amount });
		const result = await processPayment.start(run, { amount: input.amount });
		run.logger.info("Payment complete", result);
	},
});
```

## Best Practices

1. **Make Tasks Idempotent** - Tasks may be retried, so re-running should not cause unintended side effects
2. **Use Reference IDs** - Use custom reference IDs to prevent duplicate processing
3. **Use Meaningful Errors** - Help diagnose failures
4. **Log Information** - Use `run.logger` for debugging
5. **Keep Tasks Focused** - One responsibility per task

## Related Packages

- [@aikirun/workflow](https://www.npmjs.com/package/@aikirun/workflow) - Use tasks in workflows
- [@aikirun/worker](https://www.npmjs.com/package/@aikirun/worker) - Execute tasks in workers
- [@aikirun/client](https://www.npmjs.com/package/@aikirun/client) - Manage task execution
- [@aikirun/types](https://www.npmjs.com/package/@aikirun/types) - Type definitions

## Changelog

See the [CHANGELOG](https://github.com/aikirun/aiki/blob/main/CHANGELOG.md) for version history.

## License

Apache-2.0
