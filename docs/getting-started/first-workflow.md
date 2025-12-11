# Your First Workflow

Build a complete order processing workflow that demonstrates Aiki's key features.

## What We'll Build

We'll create an order processing system that validates orders, processes payments, updates inventory, and sends
confirmation emails. Each step will be a separate task, demonstrating how Aiki enables independent retry and monitoring
of workflow components.

## Step 1: Define Tasks

Each step is a separate task for independent retry and monitoring:

```typescript
import { task } from "@aikirun/task";

const validateOrder = task({
	id: "validate-order",
	exec(input: { items: Array<{ id: string; quantity: number }>; total: number }) {
		const { items, total } = input;

		// Validation logic
		if (items.length === 0) {
			throw new Error("Order must have items");
		}

		return {
			valid: true,
			orderId: `order-${Date.now()}`,
			total,
		};
	},
});

const processPayment = task({
	id: "process-payment",
	exec(input: { orderId: string; amount: number }) {
		const { orderId, amount } = input;

		// Payment processing logic
		console.log(`Processing payment for ${orderId}: $${amount}`);

		return {
			paymentId: `pay-${Date.now()}`,
			status: "completed",
		};
	},
});

const updateInventory = task({
	id: "update-inventory",
	exec(input: { items: Array<{ id: string; quantity: number }> }) {
		const { items } = input;

		// Update inventory
		items.forEach((item) => {
			console.log(`Updating inventory for ${item.id}`);
		});

		return { updated: true };
	},
});

const sendConfirmation = task({
	id: "send-confirmation",
	exec(input: { email: string; orderId: string }) {
		const { email, orderId } = input;

		console.log(`Sending confirmation to ${email} for order ${orderId}`);

		return { sent: true };
	},
});
```

## Step 2: Create the Workflow

Orchestrate tasks in sequence:

```typescript
import { workflow } from "@aikirun/workflow";

const orderWorkflow = workflow({
	id: "order-processing",
});

const orderWorkflowV1 = orderWorkflow.v("1.0.0", {
	async exec(input: {
		items: Array<{ id: string; quantity: number }>;
		total: number;
		email: string;
	}, run) {
		// Step 1: Validate order
		const validation = await validateOrder.start(run, {
			items: input.items,
			total: input.total,
		});

		// Step 2: Process payment
		const payment = await processPayment.start(run, {
			orderId: validation.orderId,
			amount: validation.total,
		});

		// Step 3: Update inventory
		await updateInventory.start(run, {
			items: input.items,
		});

		// Step 4: Send confirmation
		await sendConfirmation.start(run, {
			email: input.email,
			orderId: validation.orderId,
		});

		return {
			success: true,
			orderId: validation.orderId,
			paymentId: payment.paymentId,
		};
	},
});
```

## Step 3: Set Up Infrastructure

Create the client and worker:

```typescript
import { client } from "@aikirun/client";
import { worker } from "@aikirun/worker";

const aiki = await client({
	url: "localhost:9090",
	redis: {
		host: "localhost",
		port: 6379,
	},
});

const aikiWorker = await worker(aiki, {
	id: "order-worker-1",
	maxConcurrentWorkflowRuns: 10,
	subscriber: {
		type: "redis_streams",
		claimMinIdleTimeMs: 60_000,
	},
});

// Register the workflow
aikiWorker.registry.add(orderWorkflow);

// Start processing
await aikiWorker.start();
```

## Step 4: Execute the Workflow

Process an order:

```typescript
const result = await orderWorkflowV1.start(aiki, {
	items: [
		{ id: "item-1", quantity: 2 },
		{ id: "item-2", quantity: 1 },
	],
	total: 99.99,
	email: "customer@example.com",
});

console.log("Workflow started:", result.id);

// Wait for completion
const finalResult = await result.waitForCompletion();
console.log("Order processed:", finalResult);
```

## Complete Code

```typescript
import { client } from "@aikirun/client";
import { task } from "@aikirun/task";
import { worker } from "@aikirun/worker";
import { workflow } from "@aikirun/workflow";

// Define tasks
const validateOrder = task({
	id: "validate-order",
	exec(input: { items: Array<{ id: string; quantity: number }>; total: number }) {
		if (input.items.length === 0) {
			throw new Error("Order must have items");
		}
		return {
			valid: true,
			orderId: `order-${Date.now()}`,
			total: input.total,
		};
	},
});

const processPayment = task({
	id: "process-payment",
	exec(input: { orderId: string; amount: number }) {
		console.log(`Processing payment: $${input.amount}`);
		return {
			paymentId: `pay-${Date.now()}`,
			status: "completed",
		};
	},
});

const updateInventory = task({
	id: "update-inventory",
	exec(input: { items: Array<{ id: string; quantity: number }> }) {
		input.items.forEach((item) => {
			console.log(`Updating inventory for ${item.id}`);
		});
		return { updated: true };
	},
});

const sendConfirmation = task({
	id: "send-confirmation",
	exec(input: { email: string; orderId: string }) {
		console.log(`Sending confirmation to ${input.email}`);
		return { sent: true };
	},
});

// Define workflow
const orderWorkflow = workflow({ id: "order-processing" });

const orderWorkflowV1 = orderWorkflow.v("1.0.0", {
	async exec(input: {
		items: Array<{ id: string; quantity: number }>;
		total: number;
		email: string;
	}, run) {
		const validation = await validateOrder.start(run, {
			items: input.items,
			total: input.total,
		});

		const payment = await processPayment.start(run, {
			orderId: validation.orderId,
			amount: validation.total,
		});

		await updateInventory.start(run, {
			items: input.items,
		});

		await sendConfirmation.start(run, {
			email: input.email,
			orderId: validation.orderId,
		});

		return {
			success: true,
			orderId: validation.orderId,
			paymentId: payment.paymentId,
		};
	},
});

// Set up client and worker
const aiki = await client({
	url: "localhost:9090",
	redis: { host: "localhost", port: 6379 },
});

const aikiWorker = await worker(aiki, {
	id: "order-worker",
	subscriber: { type: "redis_streams" },
});

aikiWorker.registry.add(orderWorkflow);
await aikiWorker.start();

// Execute workflow
const result = await orderWorkflowV1.start(aiki, {
	items: [{ id: "item-1", quantity: 2 }],
	total: 99.99,
	email: "customer@example.com",
});

console.log("Done:", await result.waitForCompletion());
```

## What's Happening?

Each task executes independently, so if payment fails, only the payment task is retried rather than the entire workflow.
The server persists state continuously, which means crashes don't lose progress. Idempotency ensures that the same order
won't be processed twice, even if requests are duplicated. Workers provide fault tolerance by claiming stuck workflows
from failed workers, ensuring your processes complete even when individual workers crash.

## Next Steps

- **[Task Determinism](../guides/task-determinism.md)** - Learn why tasks should be deterministic
- **[Idempotency](../guides/idempotency.md)** - Understand idempotency keys
- **[Error Handling](../guides/error-handling.md)** - Handle failures gracefully
- **[Workflows](../core-concepts/workflows.md)** - Deep dive into workflow concepts
