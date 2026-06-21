# Your First Workflow

Build a restaurant ordering workflow that demonstrates Aiki's key features: events, timeouts, child workflows, and durable sleep.

## What We'll Build

A restaurant ordering system that:
- Notifies the restaurant and waits for acceptance (with timeout)
- Coordinates courier delivery as a child workflow
- Sends a follow-up feedback email after a short delay

In production, a workflow like this spans hours or days and coordinates multiple humans—exactly what Aiki is designed for. The tutorial compresses every wait to seconds so you can watch it run end to end.

## Step 1: Define Tasks

Each task is an independent unit of work that can be retried separately:

```typescript
import { task } from "@aikirun/workflow";

const notifyRestaurant = task({
	name: "notify-restaurant",
	async handler(input: { orderId: string; items: string[] }) {
		console.log(`Notifying restaurant about order ${input.orderId}`);
		console.log(`Items: ${input.items.join(", ")}`);
	},
	options: {
		retry: {
			type: "exponential",
			maxAttempts: 3,
			baseDelayMs: 1000,
		},
	},
});

const notifyCustomer = task({
	name: "notify-customer",
	async handler(input: { customerId: string; message: string }) {
		console.log(`To customer ${input.customerId}: ${input.message}`);
	},
});

const sendFeedbackEmail = task({
	name: "send-feedback-email",
	async handler(input: { orderId: string; customerId: string }) {
		console.log(`Sending feedback request for order ${input.orderId}`);
	},
});
```

## Step 2: Define the Courier Delivery Workflow

The courier delivery is a child workflow — a separate workflow that runs independently:

```typescript
import { event, workflow } from "@aikirun/workflow";

const courierDelivery = workflow({ name: "courier-delivery" });

const courierDeliveryV1 = courierDelivery.v("1.0.0", {
	async handler(run, input: { orderId: string; restaurantId: string }) {
		run.logger.info("Finding available courier...");

		// Simulate courier search
		await run.sleep("find-courier", { seconds: 2 });

		run.logger.info("Courier assigned, waiting for food to be ready...");

		// Wait for restaurant to signal food is ready
		await run.events.foodReady.wait();

		run.logger.info("Food ready! Courier picking up...");
		await run.sleep("delivery", { seconds: 2 });

		run.logger.info("Order delivered!");
		return { courierName: "Oluwafemi" };
	},
	events: {
		foodReady: event(),
	},
});
```

## Step 3: Define the Main Restaurant Order Workflow

This workflow orchestrates the entire order process:

```typescript
const restaurantOrder = workflow({ name: "restaurant-order" });

const restaurantOrderV1 = restaurantOrder.v("1.0.0", {
	async handler(run, input: { orderId: string; customerId: string; items: string[] }) {
		// Step 1: Notify restaurant
		await notifyRestaurant.start(run, {
			orderId: input.orderId,
			items: input.items,
		});

		// Step 2: Wait for restaurant to accept (with 5 minute timeout)
		const response = await run.events.restaurantAccepted.wait({
			timeout: { minutes: 5 },
		});

		if (response.timeout) {
			await notifyCustomer.start(run, {
				customerId: input.customerId,
				message: "Restaurant didn't respond. Order cancelled.",
			});
			return { status: "cancelled", reason: "timeout" };
		}

		// Step 3: Notify customer of acceptance
		await notifyCustomer.start(run, {
			customerId: input.customerId,
			message: `Order confirmed! Estimated time: ${response.data.estimatedTime} mins`,
		});

		// Step 4: Start courier delivery as child workflow
		// (with reference ID for external access)
		const deliveryHandle = await courierDeliveryV1
			.with()
			.opt("reference.id", input.orderId)
			.startAsChild(run, {
				orderId: input.orderId,
				restaurantId: "restaurant-1",
			});

		// Step 5: Wait for delivery to complete
		const deliveryResult = await deliveryHandle.waitForStatus("completed");
		if (!deliveryResult.success) {
			return { status: "failed", reason: "delivery_failed" };
		}

		// Step 6: Notify customer of delivery (using child workflow output)
		const { courierName } = deliveryResult.state.output;
		await notifyCustomer.start(run, {
			customerId: input.customerId,
			message: `Your order was delivered by ${courierName}. Enjoy!`,
		});

		// Step 7: Sleep briefly, then request feedback
		await run.sleep("feedback-delay", { seconds: 30 });
		await sendFeedbackEmail.start(run, {
			orderId: input.orderId,
			customerId: input.customerId,
		});

		return { status: "completed", orderId: input.orderId };
	},
	events: {
		restaurantAccepted: event<{ estimatedTime: number }>(),
	},
});
```

## Step 4: Bootstrap the Server and Worker

Run the server and a worker in this process, connected by the client:

```typescript
import { client } from "@aikirun/client";
import { database, server } from "@aikirun/server";
import { worker } from "@aikirun/worker";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://user:password@localhost:5432/aiki";

const aikiServer = server({ db: database({ provider: "pg", url: databaseUrl }) });
const runtimeHandle = aikiServer.runtime.start();

const aikiClient = client({ handler: aikiServer.handler });

const aikiWorker = worker({
	workflows: [restaurantOrderV1, courierDeliveryV1],
});
const workerHandle = aikiWorker.spawn(aikiClient);

// Graceful shutdown
process.on("SIGINT", async () => {
	await workerHandle.stop();
	await runtimeHandle.stop();
	process.exit(0);
});
```

> **Note:** This tutorial runs the server and worker in a single process — the simplest shape. The server can also run in its own process, with workers and application code connecting over HTTP (`client({ url })`); workflow code is unchanged either way. See [Installation](./installation.md) for the standalone setup.

## Step 5: Execute the Workflow

Start the workflow and send events:

```typescript
// Start the order workflow
const orderId = crypto.randomUUID();
const customerId = crypto.randomUUID();

const handle = await restaurantOrderV1.start(aikiClient, {
	orderId,
	customerId,
	items: ["Burger", "Fries", "Drink"],
});

console.log("Workflow started:", handle.run.id);

// Simulate restaurant accepting the order after 3 seconds
setTimeout(async () => {
	await handle.events.restaurantAccepted.send({ estimatedTime: 30 });
	console.log("Restaurant accepted the order!");
}, 3000);

// In a real app, the restaurant would send the foodReady event via API
// when the food is prepared. For this demo, we'll simulate it:
setTimeout(async () => {
	// Get the courier delivery workflow handle using the order ID as reference
	const courierHandle = await courierDeliveryV1.getHandleByReferenceId(aikiClient, orderId);
	await courierHandle.events.foodReady.send();
	console.log("Food is ready for pickup!");
}, 10000);

// Wait for completion (the 30-second feedback sleep happens here)
const result = await handle.waitForStatus("completed");
if (result.success) {
	console.log("Order completed:", result.state.output);
}
```

## What's Happening?

This workflow demonstrates Aiki's key features:

**Events & Timeouts**
The workflow waits for the restaurant to accept, but won't wait forever. If no response comes within 5 minutes, it cancels the order automatically.

**Child Workflows**
Courier delivery runs as a separate workflow. It can be monitored independently, and if the main workflow crashes, the child continues running.

**Durable Sleep**
A sleeping workflow doesn't block any workers or consume resources, and the cost is the same whether it sleeps 30 seconds or 30 days. Change the feedback delay to `{ days: 1 }` and the workflow simply resumes the next day.

**Crash Recovery**
If the server crashes at any point—while waiting on the restaurant, mid-delivery, or during the feedback wait—the workflow resumes exactly where it left off.

## Next Steps

- **[Determinism](../guides/determinism.md)** - Learn about workflow determinism and task idempotency
- **[Reference IDs](../guides/reference-ids.md)** - Custom identifiers for workflows and events
- **[Workflows](../core-concepts/workflows.md)** - Deep dive into workflow concepts
