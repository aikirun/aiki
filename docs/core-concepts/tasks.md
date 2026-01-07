# Tasks

Tasks are the building blocks of workflows. Each task represents a single unit of work that can be executed and retried
independently.

## Defining a Task

```typescript
import { task } from "@aikirun/task";

const sendEmail = task({
	name: "send-email",
	handler(input: { email: string; message: string }) {
		// Your business logic
		return sendEmailToUser(input.email, input.message);
	},
});
```

## Task Properties

### name

A unique identifier for the task. Use descriptive names like `"send-email"` or `"process-payment"`.

### handler Function

The function that performs the actual work. It receives:

- `input` - Input data for the task

```typescript
const processPayment = task({
	name: "process-payment",
	handler(input: { paymentId: string; amount: number }) {
		console.log(`Processing payment for ${input.paymentId}`);

		return processPaymentWithId(input.paymentId, input.amount);
	},
});
```

## Executing Tasks

Tasks are executed within workflows using `.start()`:

```typescript
const orderWorkflowV1 = orderWorkflow.v("1.0.0", {
	async handler(run, input: { orderData: any }) {
		const validation = await validateOrder.start(run, {
			orderData: input.orderData,
		});

		const payment = await processPayment.start(run, {
			paymentId: validation.paymentId,
			amount: validation.amount,
		});

		return { success: true };
	},
});
```

## Task Retry

Configure automatic retries for failed tasks using the `opts.retry` property:

```typescript
const processPayment = task({
	name: "process-payment",
	handler(input: { paymentId: string; amount: number }) {
		return paymentService.charge(input.paymentId, input.amount);
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

For available strategies and best practices, see the **[Retry Strategies Guide](../guides/retry-strategies.md)**.

## Task Input

The task receives input directly:

```typescript
const exampleTask = task({
	name: "example",
	handler(input: { data: string }) {
		// input: Input data for this task
		console.log("Task input:", input);

		return { processed: true };
	},
});
```

## Automatic Idempotency

Tasks within a workflow are automatically idempotent - the same task with the same payload only executes once:

```typescript
const sendEmail = task({
	name: "send-email",
	handler(input: { email: string; message: string }) {
		return sendEmailToUser(input.email, input.message);
	},
});

// In a workflow:
// First call: Executes the task
await sendEmail.start(run, {
	email: "user@example.com",
	message: "Hello",
});

// Second call with same input: Returns cached result
await sendEmail.start(run, {
	email: "user@example.com",
	message: "Hello",
});
```

To force re-execution, use the `with()` builder:

```typescript
await sendEmail.with().opt("reference.id", "second-email").start(run, {
	email: "user@example.com",
	message: "Hello",
});
```

## Task Best Practices

1. **Keep tasks focused** - One responsibility per task
2. **Make tasks deterministic** - Same input → same output
3. **Avoid side effects** - Be careful with external state
4. **Use meaningful names** - Clear, descriptive task names

## Common Patterns

### Validation Task

```typescript
const validateOrder = task({
	name: "validate-order",
	handler(input: { items: Array<{ id: string; quantity: number }> }) {
		if (input.items.length === 0) {
			throw new Error("Order must have items");
		}

		return {
			valid: true,
			orderId: generateOrderId(input),
		};
	},
});
```

### External API Call

```typescript
const fetchUserData = task({
	name: "fetch-user-data",
	handler(input: { userId: string }) {
		return fetch(`https://api.example.com/users/${input.userId}`)
			.then((res) => res.json());
	},
});
```

### Database Operation

```typescript
const updateInventory = task({
	name: "update-inventory",
	handler(input: { itemId: string; amount: number }) {
		return db.inventory.update({
			where: { id: input.itemId },
			data: { quantity: { decrement: input.amount } },
		});
	},
});
```

See the **[Dependency Injection Guide](../guides/dependency-injection.md)** for patterns on injecting dependencies like `db` into tasks.

## Next Steps

- **[Workflows](./workflows.md)** - Learn about workflow orchestration
- **[Determinism](../guides/determinism.md)** - Workflow determinism and task idempotency
- **[Reference IDs](../guides/reference-ids.md)** - Custom identifiers for workflows and tasks
