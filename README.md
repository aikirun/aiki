# Aiki - Durable Workflow Engine

When you're building business applications, you often need to orchestrate complex processes that span multiple steps, external services, and time. Think of order processing, user onboarding, or data migration workflows. These processes are tricky because they can fail at any point - a server might restart, a network call could timeout, or a long-running operation might get interrupted.

Traditional approaches to these problems often lead to brittle, hard-to-maintain code. You end up with complex retry logic scattered throughout your application, inconsistent error handling, and processes that can't survive infrastructure changes.

Aiki is a durable workflow engine that helps you build these complex business processes in a more reliable way. It's built with TypeScript and runs on both Node.js and Deno, giving you the flexibility to deploy it in your existing infrastructure.

## The Problem with Traditional Approaches

Let me illustrate the challenges with a typical scenario. Imagine you're building an order processing system:

```typescript
// Traditional approach - brittle and hard to maintain
async function processOrder(orderData) {
  try {
    // Step 1: Validate order
    const validation = await validateOrder(orderData);
    if (!validation.valid) {
      throw new Error("Invalid order");
    }
    
    // Step 2: Process payment
    const payment = await processPayment(validation.paymentId, validation.amount);
    if (!payment.success) {
      throw new Error("Payment failed");
    }
    
    // Step 3: Update inventory
    await updateInventory(orderData.items);
    
    // Step 4: Send confirmation
    await sendOrderConfirmation(orderData.email);
    
    return { success: true };
  } catch (error) {
    // What happens if the server crashes after payment but before inventory update?
    // How do you handle retries without double-charging?
    // How do you track the progress of long-running orders?
    console.error("Order processing failed:", error);
    throw error;
  }
}
```

This approach has several problems:
- **No durability**: If the server crashes after payment but before inventory update, you're left in an inconsistent state
- **Complex retry logic**: You need to handle retries carefully to avoid double-charging or duplicate operations
- **Poor observability**: It's hard to track where a process failed or how long it's been running
- **Scaling challenges**: Running multiple instances can lead to race conditions

## The Durable Workflow Solution

Aiki introduces the concept of **durable workflows** - long-running business processes that can survive failures, restarts, and infrastructure changes. The key insight is separating the orchestration logic from the execution logic.

Here's how the same order processing looks with Aiki:

```typescript
import { workflow, task, worker, client } from "@aiki/sdk";

// Define individual tasks - each one is focused and can be retried independently
const validateOrder = task({
  name: "validate-order",
  run({ payload }) {
    return validateOrderData(payload.orderData);
  }
});

const processPayment = task({
  name: "process-payment",
  run({ payload }) {
    return processPaymentWithId(payload.paymentId, payload.amount);
  }
  // ⚠️ Note: Task-level retry configuration is not yet implemented.
  // Retry logic is currently handled at the workflow level.
  // retry: {
  //   type: "exponential",
  //   maxAttempts: 3,
  //   baseDelayMs: 1000
  // }
});

const updateInventory = task({
  name: "update-inventory",
  run({ payload }) {
    return updateInventoryForItems(payload.items);
  }
});

const sendConfirmation = task({
  name: "send-confirmation",
  run({ payload }) {
    return sendEmail(payload.email, confirmationTemplate);
  }
});

// Define the workflow - this orchestrates the tasks
const orderProcessingWorkflow = workflow({
  name: "order-processing"
});

const orderProcessingWorkflowV1 = orderProcessingWorkflow.v("1.0.0", {
  async run(ctx, payload: { orderData: any; email: string }) {
    // Each step is a separate task that can be retried independently
    const validation = await validateOrder.start(ctx, {
      payload: { orderData: payload.orderData }
    });

    const payment = await processPayment.start(ctx, {
      payload: { paymentId: validation.paymentId, amount: validation.amount }
    });

    await updateInventory.start(ctx, {
      payload: { items: payload.orderData.items }
    });

    await sendConfirmation.start(ctx, {
      payload: { email: payload.email }
    });

    return { success: true, orderId: validation.orderId };
  }
});
```

## How It Works

Aiki follows a **distributed architecture** where workflow orchestration is separated from execution:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Your Application                               │
│                    (Uses Aiki SDK to enqueue workflows)                     │
└─────────────────────┬───────────────────────────────────────────────────────┘
                      │
                      │ SDK Client
                      │ (Enqueues workflows)
                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Aiki Server                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │  Workflow       │  │  Task           │  │  Storage Layer              │  │
│  │  Orchestration  │  │  Management     │  │  (Workflow Runs, Tasks,     │  │
│  │                 │  │                 │  │   Results, State)           │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
└─────────────────────┬───────────────────────────────────────────────────────┘
                      │
                      │ Redis Streams / Queue System
                      │ (High-performance message distribution with fault tolerance)
                      ▼
          ┌─────────────────────────────────────────────────────────┐
          │                                                         │
          │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
          │  │   Worker A  │  │   Worker B  │  │   Worker C  │      │
          │  │             │  │             │  │             │      │
          │  │ Executes    │  │ Executes    │  │ Executes    │      │
          │  │ Workflows   │  │ Workflows   │  │ Workflows   │      │
          │  │ in YOUR     │  │ in YOUR     │  │ in YOUR     │      │
          │  │ Environment │  │ Environment │  │ Environment │      │
          │  └─────────────┘  └─────────────┘  └─────────────┘      │
          │                                                         │
          │                    Your Infrastructure                  │
          │              (Your servers, containers, etc.)           │
          └─────────────────────────────────────────────────────────┘
```

The key insight here is that **your business logic runs in your environment, not in Aiki's infrastructure**. The Aiki Server orchestrates workflows and manages state, but workers execute the actual tasks in your own infrastructure. This gives you:

- **Security**: Your sensitive data never leaves your environment
- **Integration**: Direct access to your databases, APIs, and services
- **Control**: Full control over the execution environment
- **Compliance**: Meet data residency and regulatory requirements

## Core Concepts

### Workflows
A workflow is a business process composed of multiple tasks. Think of it as a recipe that describes the steps needed to complete a business operation. Workflows are versioned, so you can update them over time without breaking existing processes.

### Tasks
Tasks are the building blocks of workflows. Each task represents a single unit of work that can be retried independently. This is essential because it allows you to handle failures gracefully - if a payment fails, you can retry just the payment without re-running the entire order validation.

### Workers
Workers are processes that execute workflows in your own environment. They poll the queue for available workflow runs and execute them locally. You can run multiple workers to scale horizontally, and they'll automatically distribute the work among themselves.

### Aiki Server
The Aiki Server orchestrates workflows and manages state, but doesn't execute your code. It coordinates with workers through a queue system, ensuring reliable message delivery and state persistence.

## Getting Started

### Installation

```bash
# Using npm
npm install @aiki/sdk

# Using Deno
import { workflow, task, worker } from "jsr:@aiki/sdk@^0.1.0";
```

### A Simple Example

Let's see how to use the order processing workflow we defined earlier:

```typescript
import { workflow, task, worker, client } from "@aiki/sdk";

// Set up the infrastructure with Redis for high-performance messaging
const aikiClient = await client({
  baseUrl: "localhost:9090",
  redis: {
    host: "localhost",
    port: 6379
  }
});

const workerInstance = await worker(aikiClient, {
  id: "order-worker",
  maxConcurrentWorkflowRuns: 5,
  subscriber: {
    type: "redis_streams",
    claimMinIdleTimeMs: 60_000 // Enable fault tolerance
  }
});

workerInstance.workflowRegistry.add(orderProcessingWorkflow);

// Start processing workflows
await workerInstance.start();

// Note: workerInstance.start() returns a Promise<void> that resolves when the worker stops.
// The worker runs indefinitely in a polling loop until stop() is called.

// Start a workflow run
const resultHandle = await orderProcessingWorkflowV1.start(aikiClient, {
  payload: {
    orderData: {
      items: [{ id: "item-1", quantity: 2 }],
      customerEmail: "customer@example.com"
    },
    email: "customer@example.com"
  }
});

const result = await resultHandle.waitForCompletion();
console.log("Order processing completed:", result);
```

## Key Benefits

- **🔄 Durability**: Workflows survive server restarts and crashes
- **🚀 Scalability**: Horizontal scaling with multiple workers
- **🛡️ Reliability**: Built-in retry mechanisms, fault tolerance, and message claiming
- **⚡ Performance**: Redis Streams integration with parallel operations
- **📊 Observability**: Track workflow and task execution status
- **🔧 Flexibility**: Cross-platform support (Node.js and Deno)
- **🔒 Security**: Execution in your own environment
- **🎯 Intelligent Polling**: Adaptive polling strategies that scale with workload

## Subscriber Strategies & Fault Tolerance

Aiki supports multiple subscriber strategies for different performance and reliability requirements.

### Redis Streams (Recommended)
High-performance strategy with built-in fault tolerance and message claiming:

```typescript
const workerInstance = await worker(client, {
  subscriber: {
    type: "redis_streams",
    claimMinIdleTimeMs: 60_000,  // Claim stuck messages after 1 minute
    blockTimeMs: 1000            // Block for 1 second waiting for new messages
  }
});
```

**Fault Tolerance Features:**
- **Message Claiming**: Workers can claim messages from failed workers using XPENDING/XCLAIM
- **Parallel Operations**: Multiple Redis streams are processed in parallel for maximum throughput
- **Fair Distribution**: Round-robin distribution prevents any single stream from being overwhelmed
- **Automatic Recovery**: Messages are automatically reprocessed if workers crash or become unresponsive

## Next Steps

This introduction gives you a taste of what Aiki can do, but there's much more to explore. The documentation covers:

- **[Core Concepts](./docs/core-concepts.md)** - Deep dive into workflows, tasks, and workers
- **[Architecture](./docs/architecture.md)** - Understanding the system design and subscriber strategies
- **[Task Determinism](./docs/task-determinism.md)** - Why tasks should be deterministic
- **[Idempotency](./docs/idempotency.md)** - Using idempotency keys for reliable execution

For complete API documentation, see the JSDoc comments in the source code.

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE) file for details. 