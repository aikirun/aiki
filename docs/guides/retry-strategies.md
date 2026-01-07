# Retry Strategies

Aiki provides automatic retry capabilities for both tasks and workflows. This guide helps you choose the right retry strategy for your use case.

## Available Strategies

### Never (Default)

No automatic retries. The task or workflow fails immediately on error.

```typescript
opts: {
	retry: { type: "never" }
}
```

**Use when:**
- Operations that shouldn't be retried (e.g., user input validation)
- Non-idempotent operations that can't safely be repeated
- You want manual control over retry logic

### Fixed

Retries with a constant delay between attempts.

```typescript
opts: {
	retry: {
		type: "fixed",
		maxAttempts: 3,
		delayMs: 1000, // 1 second between retries
	}
}
```

**Use when:**
- Simple retry scenarios
- Internal service calls with predictable recovery times
- Operations where timing isn't critical

### Exponential

Retries with increasing delays (e.g., 1s, 2s, 4s, 8s...).

```typescript
opts: {
	retry: {
		type: "exponential",
		maxAttempts: 5,
		baseDelayMs: 1000,    // Start with 1 second
		factor: 2,            // Double each time (default)
		maxDelayMs: 30000,    // Cap at 30 seconds (optional)
	}
}
```

**Use when:**
- External API calls that may be rate-limited
- Network operations with transient failures
- Services that need time to recover

### Jittered

Exponential backoff with randomization to prevent thundering herd problems.

```typescript
opts: {
	retry: {
		type: "jittered",
		maxAttempts: 5,
		baseDelayMs: 1000,
		jitterFactor: 0.5,    // Add up to 50% random variation (default)
		maxDelayMs: 30000,
	}
}
```

**Use when:**
- High-concurrency scenarios where many workflows might retry simultaneously
- Shared external resources (databases, APIs)
- Preventing synchronized retry storms

## Task vs Workflow Retry

Both tasks and workflows support retry configuration, but they serve different purposes:

### Task Retry

Retries a single unit of work within a workflow.

```typescript
const sendNotification = task({
	name: "send-notification",
	handler(input) {
		return notificationService.send(input);
	},
	opts: {
		retry: {
			type: "exponential",
			maxAttempts: 3,
			baseDelayMs: 1000,
		},
	},
});
```

- Retries only the failed task
- Other completed tasks in the workflow are not re-executed
- Good for isolating failures in specific operations

### Workflow Retry

Retries the entire workflow from where it failed.

```typescript
const orderWorkflowV1 = orderWorkflow.v("1.0.0", {
	handler(run, input) {
		// ...
	},
	opts: {
		retry: {
			type: "exponential",
			maxAttempts: 3,
			baseDelayMs: 5000,
		},
	},
});
```

- Retries from the point of failure (completed tasks are skipped)
- Useful when the workflow itself has logic that might fail
- Catches errors not handled by individual tasks

## Idempotency

**Tasks with retry must be idempotent** - running them multiple times should produce the same result.

Use idempotency keys for operations that have side effects:

```typescript
const chargeCard = task({
	name: "charge-card",
	handler(input) {
		return paymentProvider.charge({
			amount: input.amount,
			idempotencyKey: input.transactionId, // Prevents duplicate charges
		});
	},
	opts: {
		retry: { type: "exponential", maxAttempts: 3, baseDelayMs: 1000 },
	},
});
```

See the [Task Determinism Guide](./task-determinism.md) for more on writing reliable tasks.

## Next Steps

- **[Tasks](../core-concepts/tasks.md)** - Task configuration and execution
- **[Workflows](../core-concepts/workflows.md)** - Workflow orchestration
- **[Task Determinism](./task-determinism.md)** - Writing reliable, deterministic code
