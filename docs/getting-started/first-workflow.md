# Your First Workflow

Build a complete order processing workflow that demonstrates Aiki's key features.

## What We'll Build

An order processing system that:
1. Validates the order
2. Processes payment
3. Updates inventory
4. Sends confirmation email

## Step 1: Define Tasks

Each step is a separate task for independent retry and monitoring:

```typescript
import { task } from "@aiki/task";

const validateOrder = task({
  name: "validate-order",
  exec(input) {
    const { items, total } = input;

    // Validation logic
    if (items.length === 0) {
      throw new Error("Order must have items");
    }

    return {
      valid: true,
      orderId: `order-${Date.now()}`,
      total
    };
  }
});

const processPayment = task({
  name: "process-payment",
  exec(input) {
    const { orderId, amount } = input;

    // Payment processing logic
    console.log(`Processing payment for ${orderId}: $${amount}`);

    return {
      paymentId: `pay-${Date.now()}`,
      status: "completed"
    };
  }
});

const updateInventory = task({
  name: "update-inventory",
  exec(input) {
    const { items } = input;

    // Update inventory
    items.forEach(item => {
      console.log(`Updating inventory for ${item.id}`);
    });

    return { updated: true };
  }
});

const sendConfirmation = task({
  name: "send-confirmation",
  exec(input) {
    const { email, orderId } = input;

    console.log(`Sending confirmation to ${email} for order ${orderId}`);

    return { sent: true };
  }
});
```

## Step 2: Create the Workflow

Orchestrate tasks in sequence:

```typescript
import { workflow } from "@aiki/workflow";

const orderWorkflow = workflow({
  name: "order-processing"
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
      total: input.total
    });

    // Step 2: Process payment
    const payment = await processPayment.start(run, {
      orderId: validation.orderId,
      amount: validation.total
    });

    // Step 3: Update inventory
    await updateInventory.start(run, {
      items: input.items
    });

    // Step 4: Send confirmation
    await sendConfirmation.start(run, {
      email: input.email,
      orderId: validation.orderId
    });

    return {
      success: true,
      orderId: validation.orderId,
      paymentId: payment.paymentId
    };
  }
});
```

## Step 3: Set Up Infrastructure

Create the client and worker:

```typescript
import { client, worker } from "@aiki/sdk";

const aikiClient = await client({
  url: "localhost:9090",
  redis: {
    host: "localhost",
    port: 6379
  }
});

const aikiWorker = await worker(aikiClient, {
  id: "order-worker-1",
  maxConcurrentWorkflowRuns: 10,
  subscriber: {
    type: "redis_streams",
    claimMinIdleTimeMs: 60_000
  }
});

// Register the workflow
aikiWorker.workflowRegistry.add(orderWorkflow);

// Start processing
await aikiWorker.start();
```

## Step 4: Execute the Workflow

Process an order:

```typescript
const result = await orderWorkflowV1.start(aikiClient, {
  items: [
    { id: "item-1", quantity: 2 },
    { id: "item-2", quantity: 1 }
  ],
  total: 99.99,
  email: "customer@example.com"
});

console.log("Workflow started:", result.id);

// Wait for completion
const finalResult = await result.waitForCompletion();
console.log("Order processed:", finalResult);
```

## Complete Code

```typescript
import { client, worker, workflow, task } from "@aiki/sdk";

// Define tasks
const validateOrder = task({
  name: "validate-order",
  exec(input) {
    if (input.items.length === 0) {
      throw new Error("Order must have items");
    }
    return {
      valid: true,
      orderId: `order-${Date.now()}`,
      total: input.total
    };
  }
});

const processPayment = task({
  name: "process-payment",
  exec(input) {
    console.log(`Processing payment: $${input.amount}`);
    return {
      paymentId: `pay-${Date.now()}`,
      status: "completed"
    };
  }
});

const updateInventory = task({
  name: "update-inventory",
  exec(input) {
    input.items.forEach(item => {
      console.log(`Updating inventory for ${item.id}`);
    });
    return { updated: true };
  }
});

const sendConfirmation = task({
  name: "send-confirmation",
  exec(input) {
    console.log(`Sending confirmation to ${input.email}`);
    return { sent: true };
  }
});

// Define workflow
const orderWorkflow = workflow({ name: "order-processing" });

const orderWorkflowV1 = orderWorkflow.v("1.0.0", {
  async exec(input, run) {
    const validation = await validateOrder.start(run, {
      items: input.items,
      total: input.total
    });

    const payment = await processPayment.start(run, {
      orderId: validation.orderId,
      amount: validation.total
    });

    await updateInventory.start(run, {
      items: input.items
    });

    await sendConfirmation.start(run, {
      email: input.email,
      orderId: validation.orderId
    });

    return {
      success: true,
      orderId: validation.orderId,
      paymentId: payment.paymentId
    };
  }
});

// Set up client and worker
const aikiClient = await client({
  url: "localhost:9090",
  redis: { host: "localhost", port: 6379 }
});

const aikiWorker = await worker(aikiClient, {
  id: "order-worker",
  subscriber: { type: "redis_streams" }
});

aikiWorker.workflowRegistry.add(orderWorkflow);
await aikiWorker.start();

// Execute workflow
const result = await orderWorkflowV1.start(aikiClient, {
  items: [{ id: "item-1", quantity: 2 }],
  total: 99.99,
  email: "customer@example.com"
});

console.log("Done:", await result.waitForCompletion());
```

## What's Happening?

1. **Each task executes independently** - If payment fails, only payment is retried
2. **State is persisted** - Server crashes don't lose progress
3. **Idempotency** - Same order won't be processed twice
4. **Fault tolerance** - Workers can claim stuck workflows from failed workers

## Next Steps

- **[Task Determinism](../guides/task-determinism.md)** - Learn why tasks should be deterministic
- **[Idempotency](../guides/idempotency.md)** - Understand idempotency keys
- **[Error Handling](../guides/error-handling.md)** - Handle failures gracefully
- **[Workflows](../core-concepts/workflows.md)** - Deep dive into workflow concepts
