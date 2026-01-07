# Aiki

**A durable execution platform.**

Some workflows take minutes. Others take days. They need to wait for humans, survive crashes, retry on failure, and coordinate across systems. Building these with traditional code means message queues, state machines, and fragile recovery logic. With Aiki, you write normal async code and let the platform handle durability.

## Example: Restaurant Order Workflow

A restaurant ordering workflow that coordinates restaurant confirmation, courier delivery, and follow-up email the next day.

```typescript
import { event, workflow } from "@aikirun/workflow";
import { notifyRestaurant, notifyCustomer, sendFeedbackEmail } from "./tasks";
import { courierDeliveryV1 } from "./courier-workflow";

export const restaurantOrder = workflow({ name: "restaurant-order" });

export const restaurantOrderV1 = restaurantOrder.v("1.0.0", {
  async handler(run, input: { orderId: string; customerId: string; }) {

    await notifyRestaurant.start(run, input.orderId);
    
    // Wwait for acceptance with 5 mins timeout
    const response = await run.events.restaurantAccepted.wait({
      timeout: { minutes: 5 } 
    });

    if (response.timeout) {
      await notifyCustomer.start(run, {
        customerId: input.customerId,
        message: "Restaurant didn't respond. Order cancelled."
      });
      return { status: "cancelled" };
    }

    await notifyCustomer.start(run, {
      customerId: input.customerId,
      message: `Order confirmed! Estimated time: ${response.data.estimatedTime} mins`
    });

    // Start courier delivery as child workflow
    // (internally: searches for courier, waits for food ready event → pickup → delivery)
    const deliveryHandle = await courierDeliveryV1.startAsChild(run, input);

    // Wait for delivery to complete
    await deliveryHandle.waitForStatus("completed");

    await notifyCustomer.start(run, {
      customerId: input.customerId,
      message: "Your order has been delivered. Enjoy!"
    });

    // Sleep for 1 day, then request feedback
    await run.sleep("feedback-delay", { days: 1 });
    await sendFeedbackEmail.start(run, input);

    return { status: "completed" };
  },
  events: {
    restaurantAccepted: event<{ estimatedTime: number }>(),
  },
});
```

## What Just Happened?

This workflow coordinates multiple humans (restaurant staff, courier, customer) over hours or days. Here's what Aiki handles automatically:

- **Crash Recovery** — Server can crash at any point. Workflow resumes exactly where it left off.
- **Automatic Retries** — Failed tasks retry automatically based on your configured policy.
- **Durable Sleep** — The 1-day sleep for feedback doesn't block workers or consume resources.
- **Parallel Execution** — Child workflow runs on a different worker in parallel with the parent.
- **Horizontal Scaling** — Add more workers and Aiki distributes work automatically.

## Quick Start

```bash
npm install @aikirun/workflow @aikirun/task @aikirun/client @aikirun/worker
```

Start the Aiki server:

```bash
# Using Docker Compose
docker-compose up

# Or run directly with Bun
bun run server
```

```typescript
import { client } from "@aikirun/client";
import { worker } from "@aikirun/worker";
import { restaurantOrderV1 } from "./workflow";

// Connect to Aiki server
const aikiClient = await client({
  url: "localhost:9876",
  redis: { host: "localhost", port: 6379 }
});

// Start a worker
const myWorker = worker({
  name: "order-worker",
  workflows: [restaurantOrderV1],
  subscriber: { type: "redis" }
});
const workerHandle = await myWorker.spawn(aikiClient);

// Graceful shutdown
process.on("SIGINT", async () => {
  await workerHandle.stop();
  await aikiClient.close();
});

// Start a workflow
await restaurantOrderV1.start(aikiClient, {
  orderId: "order-123",
  customerId: "customer-456"
});
```

## Features

| Feature | Description |
|---------|-------------|
| **Durable Execution** | Workflows survive crashes and restarts |
| **Child Workflows** | Modular, reusable sub-workflows |
| **Typed Events** | Wait for external signals with full TypeScript support |
| **Event Timeouts** | Set deadlines for human responses |
| **Durable Sleep** | Sleep for days without blocking workers |
| **Scheduled Execution** | Start workflows at a future time |
| **Retries** | Configure retry policies for failed tasks |
| **Horizontal Scaling** | Add workers to distribute load |
| **Your Infrastructure** | Workers run in your environment |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Your Application                               │
│                    (Uses Aiki SDK to start workflows)                       │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Aiki Server                                    │
│           Orchestrates workflows, manages state, coordinates workers        │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      ▼
                     ┌───────────────────────────────────┐
                     │          Redis Streams            │
                     │     (Message distribution)        │
                     └───────────────────────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          ▼                           ▼                           ▼
   ┌─────────────┐             ┌─────────────┐             ┌─────────────┐
   │  Worker A   │             │  Worker B   │             │  Worker C   │
   │             │             │             │             │             │
   │  Executes   │             │  Executes   │             │  Executes   │
   │  workflows  │             │  workflows  │             │  workflows  │
   │  in YOUR    │             │  in YOUR    │             │  in YOUR    │
   │  environment│             │  environment│             │  environment│
   └─────────────┘             └─────────────┘             └─────────────┘
```

## Documentation

- **[Getting Started](./docs/getting-started/quick-start.md)** — Setup guide and first workflow
- **[Core Concepts](./docs/core-concepts/)** — Workflows, tasks, workers, client
- **[Architecture](./docs/architecture/)** — System design
- **[Guides](./docs/guides/)** — Best practices

## Requirements

- **Runtime**: Node.js 18+ or Bun 1.0+
- **Message Queue**: Redis 6.2+

## Packages

- [`@aikirun/workflow`](https://www.npmjs.com/package/@aikirun/workflow) — Workflow SDK
- [`@aikirun/task`](https://www.npmjs.com/package/@aikirun/task) — Task SDK
- [`@aikirun/client`](https://www.npmjs.com/package/@aikirun/client) — Client SDK
- [`@aikirun/worker`](https://www.npmjs.com/package/@aikirun/worker) — Worker SDK

## License

Apache 2.0 — see [LICENSE](LICENSE)
