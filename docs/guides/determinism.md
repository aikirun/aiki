# Determinism and Idempotency

Aiki has two guiding principles for reliable workflows:

1. **Wrap non-deterministic operations in tasks** - operations like generating random numbers or fetching the current time should happen inside tasks, not in workflow code
2. **Tasks should be idempotent** - running a task multiple times should produce the same side effects

Unlike platforms that enforce strict determinism, Aiki's content-addressable design provides flexibility for real-world code changes. See [Refactoring Workflows](./refactoring-workflows.md) for what's safe to change.

## Why Wrap Non-Deterministic Operations?

When a workflow replays (after sleeping, receiving an event, or recovering from a failure), the orchestration code runs again. Completed tasks don't re-execute—they return their cached results.

This means non-deterministic operations in workflow code will produce different results on replay, but non-deterministic operations in tasks will return the same cached result.

### The Issue

Non-deterministic operations in workflow code produce different values on replay:

```typescript
const orderWorkflowV1 = orderWorkflow.v("1.0.0", {
	async handler(run, input) {
		// ⚠️ Generates different value on every replay
		const orderId = crypto.randomUUID();

		// ... later in the workflow ...
		await run.sleep("wait-period", { hours: 1 });

		// On replay after sleep, orderId will be different!
		await processOrder.start(run, { orderId });
	},
});
```

When the workflow wakes up from sleep, it replays from the beginning. The `crypto.randomUUID()` call runs again and generates a *different* UUID, causing unexpected behavior.

### The Solution

Wrap non-deterministic operations in tasks. Task results are cached, so replays return the original value:

```typescript
const generateOrderId = task({
	name: "generate-order-id",
	handler() {
		return { orderId: crypto.randomUUID() }; // Result is cached
	},
});

const orderWorkflowV1 = orderWorkflow.v("1.0.0", {
	async handler(run, input) {
		// ✅ Correct: Same orderId on replay
		const { orderId } = await generateOrderId.start(run, {});
		await processOrder.start(run, { orderId });
	},
});
```

Now if the workflow replays, `generateOrderId` returns the cached UUID from the first execution.

### Common Non-Deterministic Operations

These should be wrapped in tasks when used in workflows:

| Operation | Example |
|-----------|---------|
| Random values | `Math.random()`, `crypto.randomUUID()` |
| Current time | `Date.now()`, `new Date()` |
| External API calls | Fetching data that may change |
| Environment state | Reading from mutable globals |

```typescript
// ✅ Wrap time in a task
const getCurrentTime = task({
	name: "get-current-time",
	handler() {
		return { timestamp: Date.now() };
	},
});

// ✅ Wrap external calls in a task
const fetchExchangeRate = task({
	name: "fetch-exchange-rate",
	handler(input: { currency: string }) {
		return exchangeRateApi.getRate(input.currency);
	},
});
```

## Task Idempotency

Tasks may execute multiple times due to retries, restarts, or network issues. Tasks with **side effects** should be idempotent; running multiple times should produce the same observable outcome in external systems.

The return value doesn't need to be identical. A task might return `{ sent: true }` on first run and `{ sent: false, reason: "already sent" }` on retry. What matters is the side effect (the email) only happened once.

### Use Idempotency Keys

External services often support idempotency keys. Pass a unique identifier to prevent duplicate operations:

```typescript
const chargeCard = task({
	name: "charge-card",
	handler(input: { transactionId: string; amount: number }) {
		return paymentProvider.charge({
			amount: input.amount,
			idempotencyKey: input.transactionId, // Prevents duplicate charges
		});
	},
});
```

### Check Before Acting

For database operations, check if the work was already done:

```typescript
const sendWelcomeEmail = task({
	name: "send-welcome-email",
	handler(input: { userId: string; email: string }) {
		// Check if already sent
		if (await wasEmailSent(input.userId, "welcome")) {
			return { sent: false, reason: "already sent" };
		}

		// Send and mark as sent
		await sendEmail(input.email, welcomeTemplate);
		await markEmailSent(input.userId, "welcome");
		return { sent: true };
	},
});
```

### Use Database Constraints

Let the database enforce uniqueness:

```typescript
const createUser = task({
	name: "create-user",
	handler(input: { userId: string; email: string }) {
		// Unique constraint on email prevents duplicates
		return db.users.upsert({
			where: { email: input.email },
			create: { id: input.userId, email: input.email },
			update: {}, // No-op if exists
		});
	},
});
```

## Summary

| Principle | Applies To | Solution |
|-----------|------------|----------|
| Non-deterministic operations | Random numbers, timestamps, API calls | Wrap in tasks, not in workflow code |
| Idempotency | Tasks with side effects | Use idempotency keys or check-before-act |

Following these principles makes your workflows easier to debug, test, and reason about.

## Next Steps

- **[Refactoring Workflows](./refactoring-workflows.md)** - Learn what's safe to change in running workflows
- **[Tasks](../core-concepts/tasks.md)** - Task definition and execution
- **[Workflows](../core-concepts/workflows.md)** - Workflow orchestration
- **[Retry Strategies](./retry-strategies.md)** - Configure automatic retries
