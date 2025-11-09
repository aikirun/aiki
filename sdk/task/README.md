# @aikirun/task

Task SDK for Aiki durable execution engine - define reliable tasks with automatic retries, idempotency, and error
handling.

## Installation

```bash
deno add jsr:@aikirun/task
```

## Quick Start

### Define a Simple Task

```typescript
import { task } from "@aikirun/task";

export const sendVerificationEmail = task({
	name: "send-verification",
	async exec(input: { email: string }) {
		return emailService.sendVerification(input.email);
	},
});
```

### Task with Retry Configuration

```typescript
export const ringAlarm = task({
	name: "ring-alarm",
	exec(input: { song: string }) {
		return Promise.resolve(audioService.play(input.song));
	},
}).withOptions({
	retry: {
		type: "fixed",
		maxAttempts: 3,
		delayMs: 1000,
	},
});
```

### Execute Task in a Workflow

```typescript
import { workflow } from "@aikirun/workflow";

export const morningWorkflow = workflow({ name: "morning-routine" });

export const morningWorkflowV1 = morningWorkflow.v("1.0", {
	async exec(input, run) {
		const result = await ringAlarm.start(run, { song: "alarm.mp3" });
		console.log("Task completed:", result);
	},
});
```

## Features

- **Deterministic Execution** - Tasks must be deterministic for reliability
- **Automatic Retries** - Multiple retry strategies (fixed, exponential, jittered)
- **Idempotency** - Tasks can safely be retried without side effects
- **Error Handling** - Structured error information with recovery strategies
- **State Tracking** - Task execution state persists across failures
- **Type Safety** - Full TypeScript support with input/output types

## Task Configuration

```typescript
interface TaskOptions {
	retry?: RetryStrategy; // Retry strategy
	idempotencyKey?: string; // For deduplication
}
```

### Retry Strategies

#### Never Retry

```typescript
.withOptions({
  retry: { type: "never" },
})
```

#### Fixed Delay

```typescript
.withOptions({
  retry: {
    type: "fixed",
    maxAttempts: 3,
    delayMs: 1000,
  },
})
```

#### Exponential Backoff

```typescript
.withOptions({
  retry: {
    type: "exponential",
    maxAttempts: 5,
    baseDelayMs: 1000,
    factor: 2,
    maxDelayMs: 30000,
  },
})
```

#### Jittered Exponential

```typescript
.withOptions({
  retry: {
    type: "jittered",
    maxAttempts: 5,
    baseDelayMs: 1000,
    jitterFactor: 0.1,
    maxDelayMs: 30000,
  },
})
```

## Execution Context

Tasks are executed within a workflow's execution context. Logging happens in the workflow:

```typescript
export const processPayment = task({
	name: "process-payment",
	async exec(input: { amount: number }) {
		return { success: true, transactionId: "tx_123" };
	},
});

export const paymentWorkflowV1 = paymentWorkflow.v("1.0", {
	async exec(input, run) {
		run.logger.info("Processing payment", { amount: input.amount });
		const result = await processPayment.start(run, { amount: input.amount });
		run.logger.info("Payment complete", result);
	},
});
```

## Best Practices

1. **Make Tasks Deterministic** - Same input should always produce same output
2. **Handle Idempotency** - Tasks may be retried multiple times
3. **Use Meaningful Errors** - Help diagnose failures
4. **Log Information** - Use `run.logger` for debugging
5. **Keep Tasks Focused** - One responsibility per task

## Related Packages

- [@aikirun/workflow](https://jsr.io/@aikirun/workflow) - Use tasks in workflows
- [@aikirun/worker](https://jsr.io/@aikirun/worker) - Execute tasks in workers
- [@aikirun/client](https://jsr.io/@aikirun/client) - Manage task execution
- [@aikirun/lib](https://jsr.io/@aikirun/lib) - Retry utilities

## License

Apache-2.0
