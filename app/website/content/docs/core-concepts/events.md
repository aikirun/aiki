---
title: Events
description: Every run has a durable mailbox, so an event sent before the workflow waits for it is held until the workflow is ready.
---

Events let external systems communicate with running workflows.

Each workflow run has a durable mailbox. Sending an event drops it in the mailbox and returns; the workflow picks it up when it asks for one. The two are independent, and that is what makes events safe to use from the outside world: an event sent before the workflow reaches its `wait()` call sits in the mailbox until the workflow is ready for it.

So a wait has two outcomes. If the event is already in the mailbox, the workflow takes it and carries on. If not, the run moves to [`awaiting_event`](./workflows.md#states) and releases its worker until the event arrives or the timeout elapses.

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

Event data must be plain JSON data, like workflow inputs. See [Inputs and Outputs](./workflows.md#inputs-and-outputs).

## Event Schemas

For runtime validation, provide a schema:

```typescript
import { z } from "zod";

const orderWorkflowV1 = orderWorkflow.v("1.0.0", {
	async handler(run, input) {
		// Data is validated by the sender, before it is sent
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

The sender validates event data against the schema before sending it, so malformed data is rejected at its source rather than reaching the workflow.

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

Once a wait times out, that is its answer for good. The timeout is recorded like any other outcome, so the workflow never sits through the same 24 hours twice.

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

The send does not need the workflow to be waiting, or even to have started executing. It needs the run to be alive: once a run has completed, failed, or been cancelled, its mailbox is closed and sending to it fails.

### With Reference ID

Prevent duplicate event delivery using a reference ID:

```typescript
await handle.events.paymentReceived
	.with("reference.id", "payment-txn_abc123")
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

Sending the same event twice with the same reference ID adds one entry to the mailbox - the duplicate is ignored without error:

```typescript
// First send - lands in the mailbox
await handle.events.paymentReceived
	.with("reference.id", "payment-123")
	.send({ transactionId: "txn_abc" });

// Second send with same reference ID - silently ignored
await handle.events.paymentReceived
	.with("reference.id", "payment-123")
	.send({ transactionId: "txn_abc" });
```

This is useful when event sources may retry (webhooks, message queues). See the [Reference IDs Guide](../guides/reference-ids.md) for more patterns.

## Mailbox Order

The mailbox keeps each event name in the order the events arrived, and each `wait()` takes the next one:

```typescript
async handler(run, input) {
	const first = await run.events.update.wait();   // the first update sent
	const second = await run.events.update.wait();  // the second
	// ...
}
```

The mailbox is durable, so a wait that has been answered keeps its answer. That matters because a workflow resumes by running its handler again from the top: every wait it already passed hands back what it got the first time, the same event or the same timeout.

Event names are kept apart, so reordering waits on different events in your handler does not change what they read.

### Don't Rely on Same-Named Event Order

The mailbox order is fixed, but which of two racing senders reaches the server first is not. Two systems sending `statusUpdate` at the same moment will be read in a definite order, just not one you can predict from the outside:

```typescript
// DON'T rely on which arrives first
const first = await run.events.statusUpdate.wait();   // Which update is this?
const second = await run.events.statusUpdate.wait();  // Unpredictable!

// DO use a distinct event for each thing you are waiting for
const started = await run.events.started.wait();
const completed = await run.events.completed.wait();
```

Distinct event names never contend, so each wait reads what it was written to read.

The other way round is to keep one event name and put the ordering in the data - a step number, a status field - so the workflow can tell which update it is holding instead of trusting the order it arrived in.

## Next Steps

- **[Workflows](./workflows.md)** - Workflow orchestration
- **[Sleeps](./sleeps.md)** - Durable timers
- **[Reference IDs](../guides/reference-ids.md)** - Deduplication patterns
