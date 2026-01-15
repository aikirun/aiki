<p align="center">
  <img src="docs/assets/aiki-logo-combo.svg" alt="Aiki" height="80">
</p>

<p>
  <img src="https://img.shields.io/badge/status-alpha-orange" alt="Status">
  <br>
</p>

**A durable execution platform.**

Durable execution is a fault tolerant paradigm for building applications, especially long running workflows. 

Some workflows take minutes, others take days, months or years. They often need to wait for human interaction, survive crashes, retry on failure, and coordinate across systems. Building these with traditional code means coordinating message queues, crons, state machines, and fragile recovery logic. With Aiki, you focus on writing business logic and let the platform handle durability.

Aiki workflows are like a virtual thread of execution that can be suspended (intentionally or due to crashes/intermittent-failures) and automatically resumed from exactly where they left off.

## Example: Restaurant Order Workflow

Here's a dummy food ordering workflow that coordinates restaurant confirmation, courier delivery, and follow-up email the next day.

```typescript
import { event, workflow } from "@aikirun/workflow";
import { notifyRestaurant, notifyCustomer, sendFeedbackEmail } from "./tasks";
import { courierDeliveryV1 } from "./courier-workflow";

export const restaurantOrder = workflow({ name: "restaurant-order" });

export const restaurantOrderV1 = restaurantOrder.v("1.0.0", {
  async handler(run, input: { orderId: string; customerId: string; }) {

    await notifyRestaurant.start(run, input.orderId);
    
    // Wait for acceptance with 5 mins timeout
    const response = await run.events.restaurantAccepted.wait({ timeout: { minutes: 5 } });

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

## What Aiki handles automatically

- **Crash Recovery** — Server can crash at any point. Workflow resumes exactly where it left off.
- **Automatic Retries** — Failed tasks retry automatically based on your configured policy.
- **Event Suspension** — Waiting for the restaurant to accept suspends the workflow and releases the worker until the event arrives.
- **Durable Sleep** — The 1-day sleep for feedback doesn't block workers or consume resources.
- **Parallel Execution** — Child workflow runs on a different worker in parallel with the parent.
- **Horizontal Scaling** — Add more workers and Aiki distributes work automatically.

## Quick Start

Install the Aiki SDK:
```bash
npm install @aikirun/workflow @aikirun/task @aikirun/client @aikirun/worker
```

Start Aiki:

```bash
# Fist clone the repo
git clone https://github.com/aikirun/aiki.git
cd aiki

# Then start server + web UI using Docker Compose
docker-compose up

# Or run directly with Bun
bun run server  # Terminal 1 - start the server
bun run web     # Terminal 2 - start the web UI
```

The server runs on `http://localhost:9850` and the web UI on `http://localhost:9851`.

```typescript
import { client } from "@aikirun/client";
import { worker } from "@aikirun/worker";
import { restaurantOrderV1 } from "./workflow";

// Connect to Aiki server
const aikiClient = client({
  url: "http://localhost:9850",
  redis: { host: "localhost", port: 6379 }
});

// Start a worker
const myWorker = worker({
  name: "order-worker",
  workflows: [restaurantOrderV1],
  subscriber: { type: "redis" }
});
const workerHandle = await myWorker.spawn(aikiClient);

// Start a workflow
await restaurantOrderV1.start(aikiClient, {
  orderId: "order-123",
  customerId: "customer-456"
});

// Cleanup
await workerHandle.stop();
await aikiClient.close();
```
<br>
<p align="center">
  <img src="docs/assets/aiki-web-demo.gif" alt="Aiki Web UI Demo" width="800">
</p>

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
│                    Orchestrates workflows, manages state                    │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      ▼
                     ┌───────────────────────────────────┐
                     │          Message Queue            │
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

Read the [docs](./docs/README.md)

## Requirements

- **Runtime**: Node.js 18+ or Bun 1.0+
- **ESM (ES Modules)** - This package uses ES modules (`import`/`export`)
- **Message Queue**: Redis 6.2+

## Packages

- [`@aikirun/workflow`](https://www.npmjs.com/package/@aikirun/workflow) — Workflow SDK
- [`@aikirun/task`](https://www.npmjs.com/package/@aikirun/task) — Task SDK
- [`@aikirun/client`](https://www.npmjs.com/package/@aikirun/client) — Client SDK
- [`@aikirun/worker`](https://www.npmjs.com/package/@aikirun/worker) — Worker SDK

## License

Apache 2.0 — see [LICENSE](LICENSE)
