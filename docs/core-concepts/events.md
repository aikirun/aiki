# Events

Events let external systems communicate with running workflows. When a workflow waits for an event, it suspends and releases the worker until the event arrives or a timeout elapses.

## Defining Events

Define events in the workflow version using the `event()` function:

```typescript
import { event } from "@aikirun/workflow";

const orderWorkflowV1 = orderWorkflow.v("1.0.0", {
	async handler(run, input) {
		const response = await run.events.paymentReceived.wait();
		// Process payment...
	},
	events: {
		paymentReceived: event<{ transactionId: string; amount: number }>(),
		cancelled: event(),  // Event with no data
	},
});
```

## Event Schemas

For runtime validation, provide a schema:

```typescript
import { z } from "zod";

const orderWorkflowV1 = orderWorkflow.v("1.0.0", {
	async handler(run, input) {
		// Data is validated when the event is received
		const { data } = await run.events.paymentReceived.wait();
	},
	events: {
		paymentReceived: event<{ transactionId: string; amount: number }>({
			schema: z.object({
				transactionId: z.string(),
				amount: z.number().positive(),
			}),
		}),
	},
});
```

Schemas validate event data when received, protecting against malformed external data.

## Waiting for Events

Call `run.events.eventName.wait()` to wait for an event:

```typescript
const { data } = await run.events.paymentReceived.wait();
console.log("Payment received:", data.transactionId);
```

### With Timeout

Specify a timeout to avoid waiting indefinitely:

```typescript
const response = await run.events.paymentReceived.wait({
	timeout: { hours: 24 },
});

if (response.timeout) {
	// No payment received within 24 hours
	await cancelOrder.start(run, input);
} else {
	// Payment received
	await processPayment.start(run, { transactionId: response.data.transactionId });
}
```

## Sending Events

Send events to a workflow using the handle:

```typescript
const handle = await orderWorkflowV1.start(client, { orderId: "123" });

// Later, when payment is received
await handle.events.paymentReceived.send({
	transactionId: "txn_abc123",
	amount: 99.99,
});
```

### With Reference ID

Prevent duplicate event delivery using a reference ID:

```typescript
await handle.events.paymentReceived
	.with()
	.opt("reference.id", "payment-txn_abc123")
	.send({ transactionId: "txn_abc123", amount: 99.99 });
```

See the [Reference IDs Guide](../guides/reference-ids.md) for details.

## Waiting for Multiple Events (AND)

Use `Promise.all` to wait for multiple events. The workflow proceeds only when all events are received:

```typescript
const orderWorkflowV1 = orderWorkflow.v("1.0.0", {
	async handler(run, input) {
		// Wait for both payment AND shipping confirmation
		const [payment, shipping] = await Promise.all([
			run.events.paymentReceived.wait(),
			run.events.shippingConfirmed.wait(),
		]);

		// Both events received - proceed with order completion
		await completeOrder.start(run, {
			transactionId: payment.data.transactionId,
			trackingNumber: shipping.data.trackingNumber,
		});
	},
	events: {
		paymentReceived: event<{ transactionId: string }>(),
		shippingConfirmed: event<{ trackingNumber: string }>(),
	},
});
```

## Handling Alternative Events (OR)

To handle "either this or that" scenarios, use a discriminated union in the event data:

```typescript
type OrderUpdate =
	| { type: "approved"; by: string }
	| { type: "rejected"; by: string; reason: string };

const orderWorkflowV1 = orderWorkflow.v("1.0.0", {
	async handler(run, input) {
		const { data } = await run.events.orderUpdate.wait();

		if (data.type === "approved") {
			await processApproval.start(run, { approvedBy: data.by });
		} else {
			await handleRejection.start(run, { reason: data.reason });
		}
	},
	events: {
		orderUpdate: event<OrderUpdate>(),
	},
});
```

The sender specifies which variant:

```typescript
// Approve
await handle.events.orderUpdate.send({ type: "approved", by: "manager@example.com" });

// Or reject
await handle.events.orderUpdate.send({
	type: "rejected",
	by: "manager@example.com",
	reason: "Insufficient inventory"
});
```

## Event Deduplication

Events with the same reference ID are silently deduplicated - duplicates are ignored without error:

```typescript
// First send - event delivered
await handle.events.paymentReceived
	.with()
	.opt("reference.id", "payment-123")
	.send({ transactionId: "txn_abc" });

// Second send with same reference ID - silently ignored
await handle.events.paymentReceived
	.with()
	.opt("reference.id", "payment-123")
	.send({ transactionId: "txn_abc" });
```

This is useful when event sources may retry (webhooks, message queues). See the [Reference IDs Guide](../guides/reference-ids.md) for more patterns.

## Event Queues

Each event type has its own queue, similar to sleeps. Events are matched in sequence during replay.

### Why This Matters

When a workflow resumes after waiting for an event, it replays from the beginning. The event queue ensures the same event data is returned:

```typescript
async handler(run, input) {
	const first = await run.events.update.wait();   // Reads 1st from queue
	const second = await run.events.update.wait();  // Reads 2nd from queue
	// ...
}
```

### Don't Rely on Same-Named Event Order

Unlike sleeps (which are controlled by the workflow), events come from external systems. Two different processes might trigger the same event type simultaneously, so the order is inherently unpredictable:

```typescript
// DON'T rely on order - external systems may send events in any order
const first = await run.events.statusUpdate.wait();   // Which update comes first?
const second = await run.events.statusUpdate.wait();  // Unpredictable!

// DO use different event types when order matters
const started = await run.events.started.wait();
const completed = await run.events.completed.wait();
```

This is a design principle, not just a refactoring concern. Different event types can be safely reordered since each has its own queue.

## Next Steps

- **[Workflows](./workflows.md)** - Workflow orchestration
- **[Sleeps](./sleeps.md)** - Durable timers
- **[Reference IDs](../guides/reference-ids.md)** - Deduplication patterns
