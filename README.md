# Aiki - Durable Workflow Engine

Aiki is a cross-platform, durable workflow engine that enables you to build reliable, long-running business processes that can survive failures, restarts, and infrastructure changes. Built with TypeScript and designed to run on both Node.js and Deno.

## What is Aiki?

Aiki is a workflow orchestration library that helps you build complex, reliable business processes by breaking them down into smaller, manageable tasks. It provides durability, fault tolerance, and scalability for your workflow executions.

## The Problem

Traditional application logic fails when:
- Servers restart or crash
- Network calls timeout or fail
- Long-running processes get interrupted
- You need to handle complex retry logic
- You want to track and monitor business processes

## The Solution: Durable Workflows

Durable workflows are long-running business processes that:
- **Survive failures**: Workflows continue from where they left off after crashes
- **Handle retries**: Built-in retry mechanisms with configurable strategies
- **Provide visibility**: Track workflow and task execution status
- **Scale horizontally**: Multiple workers can process workflows concurrently
- **Ensure consistency**: Tasks are executed exactly once with proper error handling

## Durable Workflows vs Saga Pattern

While both approaches handle distributed transactions, durable workflows offer significant advantages over the traditional Saga pattern:

### **Saga Pattern Limitations**

The Saga pattern, while useful, has several drawbacks:

- **Complex Compensation Logic**: Requires implementing complex rollback mechanisms for each step
- **Error Handling Complexity**: Manual orchestration of compensating transactions
- **Debugging Difficulty**: Hard to track which steps completed and which failed
- **State Management**: No built-in state persistence across failures
- **Limited Observability**: Difficult to monitor progress and diagnose issues
- **Tight Coupling**: Steps are often tightly coupled to specific services

### **Why Durable Workflows Are Better**

Durable workflows solve these problems by providing:

#### **1. Automatic State Persistence**
```typescript
// With Saga: Manual state tracking required
let sagaState = { step1: 'completed', step2: 'failed' };

// With Aiki: Automatic state persistence
const workflow = workflow({
  name: "order-processing",
  version: "1.0.0",
  async run({ workflowRun }) {
    // State is automatically saved after each task
    await validateOrder.run(workflowRun, { payload: order });
    await processPayment.run(workflowRun, { payload: payment });
    await shipOrder.run(workflowRun, { payload: shipping });
  }
});
```

#### **2. Built-in Retry Mechanisms**
```typescript
// With Saga: Manual retry logic
try {
  await processPayment();
} catch (error) {
  await delay(1000);
  await processPayment(); // Manual retry
}

// With Aiki: Declarative retry configuration
const processPayment = task({
  name: "process-payment",
  retry: {
    type: "exponential",
    maxAttempts: 3,
    baseDelayMs: 1000
  },
  run({ payload }) {
    // Automatic retries on failure
  }
});
```

#### **3. Simplified Error Handling**
```typescript
// With Saga: Complex compensation logic
async function processOrder() {
  try {
    await validateOrder();
    await processPayment();
    await shipOrder();
  } catch (error) {
    // Manual compensation
    await refundPayment();
    await cancelOrder();
  }
}

// With Aiki: Automatic error handling
const workflow = workflow({
  name: "order-processing",
  version: "1.0.0",
  async run({ workflowRun }) {
    // Each task handles its own errors
    // Failed tasks are automatically retried
    // No manual compensation needed
    await validateOrder.run(workflowRun, { payload: order });
    await processPayment.run(workflowRun, { payload: payment });
    await shipOrder.run(workflowRun, { payload: shipping });
  }
});
```

#### **4. Enhanced Observability**
```typescript
// With Aiki: Built-in monitoring
const resultHandle = await workflow.enqueue(client, { payload: order });

// Track progress
const status = await resultHandle.getStatus();
console.log(`Workflow ${status.id} is ${status.state}`);

// Wait for completion
const result = await resultHandle.waitForCompletion();
```

#### **5. Horizontal Scalability**
```typescript
// Multiple workers can process workflows concurrently
const worker1 = await worker(client, { id: "worker-1" });
const worker2 = await worker(client, { id: "worker-2" });
const worker3 = await worker(client, { id: "worker-3" });

// Each worker processes different workflow runs
worker1.start();
worker2.start();
worker3.start();
```

### **Key Advantages Summary**

| Feature | Saga Pattern | Durable Workflows |
|---------|-------------|-------------------|
| **State Management** | Manual | Automatic |
| **Error Handling** | Complex compensation | Built-in retries |
| **Observability** | Limited | Rich monitoring |
| **Scalability** | Manual coordination | Automatic distribution |
| **Debugging** | Difficult | Easy with state tracking |
| **Development Speed** | Slow (complex logic) | Fast (declarative) |
| **Maintenance** | High (complex code) | Low (simple configuration) |

Durable workflows provide a more robust, maintainable, and scalable solution for complex business processes compared to traditional Saga implementations.

## Core Concepts

### Workflows
A workflow is a business process composed of multiple tasks. Workflows are versioned and can be updated over time.

```typescript
import { workflow } from "@aiki/sdk/workflow";

const morningRoutineWorkflow = workflow({
  name: "morning-routine",
  version: "1.0.0",
  async run({ workflowRun }) {
    const alarmResult = await ringAlarm.run(workflowRun, {
      payload: { song: "Wake up!" }
    });
    
    const stretchResult = await stretch.run(workflowRun, {
      payload: { duration: 300 }
    });
    
    return { alarmResult, stretchResult };
  }
});
```

### Tasks
Tasks are the building blocks of workflows. Each task represents a single unit of work that can be retried independently.

```typescript
import { task } from "@aiki/sdk/task";

const ringAlarm = task({
  name: "ring-alarm",
  run({ payload }) {
    // Your business logic here
    return Promise.resolve(payload.song);
  },
  retry: {
    type: "fixed",
    maxAttempts: 3,
    delayMs: 1000
  }
});
```

### Workflow Runs
A workflow run is an instance of a workflow execution. It tracks the state, progress, and results of a specific workflow execution.

### Workers
Workers are processes that execute workflows. They poll for available workflow runs and execute them concurrently.

```typescript
import { worker } from "@aiki/sdk/worker";

const workerInstance = await worker(client, {
  id: "worker-1",
  maxConcurrentWorkflowRuns: 5,
  workflowRunSubscriber: {
    pollIntervalMs: 100,
    maxBatchSize: 10
  }
});

workerInstance.registry
  .add(morningRoutineWorkflow)
  .add(eveningRoutineWorkflow);

workerInstance.start();
```

### Client
The client provides access to workflow operations like enqueueing new workflow runs and managing workflow execution.

```typescript
import { createClient } from "@aiki/sdk/client";

const client = await createClient({ url: "localhost:9090" });

const resultHandle = await morningRoutineWorkflow.enqueue(client, {
  payload: { song: "Good morning!", duration: 300 }
});

const result = await resultHandle.waitForCompletion();
```

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Application   │    │   Application   │    │   Application   │
│   (Enqueues     │    │   (Enqueues     │    │   (Enqueues     │
│   Workflows)    │    │   Workflows)    │    │   Workflows)    │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌─────────────▼─────────────┐
                    │        Client             │
                    │  (Workflow Management)    │
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │   Workflow Registry       │
                    │  (Workflow Definitions)   │
                    └─────────────┬─────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
┌─────────▼─────────┐  ┌─────────▼─────────┐  ┌─────────▼─────────┐
│     Worker A      │  │     Worker B      │  │     Worker C      │
│  (Executes        │  │  (Executes        │  │  (Executes        │
│   Workflows)      │  │   Workflows)      │  │   Workflows)      │
└─────────┬─────────┘  └─────────┬─────────┘  └─────────┬─────────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌─────────────▼─────────────┐
                    │   Storage Layer           │
                    │  (Workflow Runs, Tasks,   │
                    │   Results, State)         │
                    └───────────────────────────┘
```

## Key Features

### 🔄 **Durability**
- Workflows survive server restarts and crashes
- Automatic state persistence and recovery
- Exactly-once task execution

### 🚀 **Scalability**
- Horizontal scaling with multiple workers
- Configurable concurrency limits
- Efficient polling and batching

### 🛡️ **Reliability**
- Built-in retry mechanisms
- Configurable retry strategies (fixed, exponential, jittered)
- Graceful error handling and recovery

### 📊 **Observability**
- Workflow and task execution tracking
- Heartbeat monitoring
- Execution history and results

### 🔧 **Flexibility**
- Type-safe workflow and task definitions
- Versioned workflows
- Cross-platform support (Node.js and Deno)

## Getting Started

### Installation

```bash
# Using npm
npm install @aiki/sdk

# Using Deno
import { workflow, task, worker } from "jsr:@aiki/sdk@^0.1.0";
```

### Basic Example

```typescript
import { workflow, task, worker, createClient } from "@aiki/sdk";

// Define a task
const sendEmail = task({
  name: "send-email",
  run({ payload }) {
    // Send email logic
    return Promise.resolve({ sent: true, to: payload.recipient });
  },
  retry: {
    type: "exponential",
    maxAttempts: 3,
    baseDelayMs: 1000
  }
});

// Define a workflow
const onboardingWorkflow = workflow({
  name: "user-onboarding",
  version: "1.0.0",
  async run({ workflowRun }) {
    const emailResult = await sendEmail.run(workflowRun, {
      payload: { recipient: "user@example.com" }
    });
    
    return { emailSent: emailResult.sent };
  }
});

// Create a client and worker
const client = await createClient({ url: "localhost:9090" });

const workerInstance = await worker(client, {
  id: "onboarding-worker",
  maxConcurrentWorkflowRuns: 5
});

workerInstance.registry.add(onboardingWorkflow);

// Start the worker
workerInstance.start();

// Enqueue a workflow run
const resultHandle = await onboardingWorkflow.enqueue(client, {
  payload: { recipient: "newuser@example.com" }
});

const result = await resultHandle.waitForCompletion();
console.log("Onboarding completed:", result);
```

## Advanced Features

### Retry Strategies

```typescript
// Fixed delay retry
retry: {
  type: "fixed",
  maxAttempts: 3,
  delayMs: 1000
}

// Exponential backoff
retry: {
  type: "exponential",
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000
}

// Jittered exponential backoff
retry: {
  type: "jittered",
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000
}
```

### Workflow Versioning

```typescript
// Version 1.0.0
const workflowV1 = workflow({
  name: "my-workflow",
  version: "1.0.0",
  // ... implementation
});

// Version 2.0.0 with breaking changes
const workflowV2 = workflow({
  name: "my-workflow",
  version: "2.0.0",
  // ... new implementation
});
```

## Task Determinism

Tasks in durable workflows should be **deterministic** - given the same input, they should always produce the same output. This is crucial for workflow reliability and correctness.

### What is Determinism?

A deterministic task:
- Always returns the same result for the same input
- Has no side effects that depend on external state
- Doesn't rely on random numbers, timestamps, or external APIs that could change

### Why Determinism Matters

#### **1. Reliable Replay**
When a workflow fails and restarts, tasks must produce the same results to ensure consistency:

```typescript
// ❌ Non-deterministic task
const badTask = task({
  name: "bad-task",
  run({ payload }) {
    // This will produce different results on each run
    const randomId = Math.random();
    const timestamp = Date.now();
    return { id: randomId, time: timestamp };
  }
});

// ✅ Deterministic task
const goodTask = task({
  name: "good-task",
  run({ payload }) {
    // Same input always produces same output
    const userId = payload.userId;
    const email = `${userId}@example.com`;
    return { email, userId };
  }
});
```

#### **2. Predictable State Recovery**
If a workflow crashes after completing some tasks, deterministic tasks ensure the workflow can resume correctly:

```typescript
const orderWorkflow = workflow({
  name: "process-order",
  version: "1.0.0",
  async run({ workflowRun }) {
    // If this workflow crashes after validateOrder completes,
    // it will resume here with the same result
    const validation = await validateOrder.run(workflowRun, {
      payload: workflowRun.params.payload
    });
    
    // This will always produce the same result for the same order
    const payment = await processPayment.run(workflowRun, {
      payload: { orderId: validation.orderId, amount: validation.amount }
    });
  }
});
```

#### **3. Debugging and Testing**
Deterministic tasks make workflows easier to debug and test:

```typescript
// Easy to test - same input, same output
const testTask = task({
  name: "calculate-tax",
  run({ payload }) {
    const { amount, taxRate } = payload;
    return { tax: amount * taxRate, total: amount * (1 + taxRate) };
  }
});

// Test case
const result = await testTask.run(mockWorkflowRun, {
  payload: { amount: 100, taxRate: 0.1 }
});
// result will always be { tax: 10, total: 110 }
```

### Making Tasks Deterministic

#### **Avoid Non-Deterministic Operations**

```typescript
// ❌ Avoid these in tasks:
const badPractices = task({
  name: "bad-practices",
  run({ payload }) {
    // Don't use random numbers
    const random = Math.random();
    
    // Don't use current timestamps
    const now = Date.now();
    
    // Don't use external APIs that might change
    const weather = await fetchWeatherAPI();
    
    // Don't use global state
    const globalCounter = incrementGlobalCounter();
    
    return { random, now, weather, globalCounter };
  }
});

// ✅ Use deterministic alternatives:
const goodPractices = task({
  name: "good-practices",
  run({ payload }) {
    // Use provided IDs or generate from input
    const id = generateIdFromInput(payload);
    
    // Use provided timestamps or calculate from input
    const calculatedTime = payload.createdAt + payload.duration;
    
    // Use provided data or fetch once and store
    const userData = payload.userData;
    
    // Use local state based on input
    const localCounter = payload.sequenceNumber;
    
    return { id, calculatedTime, userData, localCounter };
  }
});
```

#### **Handle External Dependencies**
For tasks that need external data, make them deterministic by:
- Passing external data as input
- Using idempotent operations
- Storing external state in the workflow context

```typescript
// ✅ Good: External data passed as input
const sendEmail = task({
  name: "send-email",
  run({ payload }) {
    // Email content is deterministic based on input
    const { recipient, template, variables } = payload;
    const emailContent = generateEmail(template, variables);
    
    // Send email (idempotent operation)
    return sendEmailToRecipient(recipient, emailContent);
  }
});

// ✅ Good: Store external state in workflow
const processPayment = task({
  name: "process-payment",
  run({ payload, workflowRun }) {
    // Use workflow state to ensure determinism
    const paymentId = workflowRun.params.paymentId;
    const amount = workflowRun.params.amount;
    
    // Process payment with deterministic parameters
    return processPaymentWithId(paymentId, amount);
  }
});
```

### Benefits of Deterministic Tasks

1. **Reliability**: Workflows can be safely retried and resumed
2. **Consistency**: Same input always produces same output
3. **Debuggability**: Easy to reproduce and debug issues
4. **Testability**: Simple to write unit tests
5. **Predictability**: Workflow behavior is predictable and trustworthy

By following these principles, your workflows become more reliable, easier to maintain, and more trustworthy in production environments.

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## Roadmap

- [ ] Sub-workflow support
- [ ] Workflow scheduling (cron expressions)
- [ ] Webhook integration
- [ ] Enhanced monitoring and metrics
- [ ] Workflow cancellation
- [ ] Payload encryption
- [ ] Lambda/Serverless worker support
- [ ] More retry strategies
- [ ] Workflow templates 