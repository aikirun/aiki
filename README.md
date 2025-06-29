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

### Aiki Server
The Aiki Server is responsible for orchestrating workflows and communicating with workers. It manages workflow state, handles workflow enqueueing, and coordinates with the queue system. The server does not execute workflows or tasks - it only manages their lifecycle and state.

### Workers
Workers are processes that execute workflows in your own environment and infrastructure. They poll the queue for available workflow runs and execute them locally. This design ensures that your business logic runs in your controlled environment, not in Aiki's infrastructure.

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

### Queue
The queue system stands between the Aiki Server and workers, managing the distribution of workflow runs. It ensures reliable message delivery and handles worker coordination.

### Storage
The storage layer behind the Aiki Server persists workflow and task state, execution history, and metadata. This enables durability and allows workflows to survive server restarts and failures.

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
                      │ Queue System
                      │ (Message Distribution)
                      ▼
          ┌─────────────────────────────────────────────────────────┐
          │                                                         │
          │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
          │  │   Worker A  │  │   Worker B  │  │   Worker C  │     │
          │  │             │  │             │  │             │     │
          │  │ Executes    │  │ Executes    │  │ Executes    │     │
          │  │ Workflows   │  │ Workflows   │  │ Workflows   │     │
          │  │ in YOUR     │  │ in YOUR     │  │ in YOUR     │     │
          │  │ Environment │  │ in YOUR     │  │ Environment │     │
          │  └─────────────┘  └─────────────┘  └─────────────┘     │
          │                                                         │
          │                    Your Infrastructure                  │
          │              (Your servers, containers, etc.)           │
          └─────────────────────────────────────────────────────────┘
```

### Key Architecture Benefits

#### **1. Execution in Your Environment**
- **Security**: Your business logic runs in your controlled infrastructure
- **Privacy**: Sensitive data never leaves your environment
- **Compliance**: Meet regulatory requirements for data handling
- **Integration**: Direct access to your databases, APIs, and services

#### **2. Scalability**
- **Horizontal Scaling**: Add more workers to handle increased load
- **Geographic Distribution**: Deploy workers in different regions
- **Resource Control**: Scale workers based on your infrastructure needs

#### **3. Reliability**
- **Durability**: Workflow state persisted in Aiki Server
- **Fault Tolerance**: Workers can restart without losing progress
- **Queue Reliability**: Ensures no workflow runs are lost

#### **4. Flexibility**
- **Self-Hosted or Cloud**: Choose your deployment model
- **Custom Infrastructure**: Use your existing servers, containers, or serverless
- **Technology Agnostic**: Workers can be deployed in any environment that supports the Aiki SDK

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

#### **1. Best Effort Once Execution**
Tasks in durable workflows are executed with **best effort once** semantics, not exactly once. This means:
- Tasks may be executed multiple times due to retries, restarts, or network issues
- The same task might run twice with the same input
- Determinism ensures that duplicate executions produce the same result

```typescript
// ❌ Non-deterministic task - dangerous with duplicate execution
const badTask = task({
  name: "create-user",
  run({ payload }) {
    // This could create duplicate users if executed twice
    const userId = generateRandomId(); // Different each time
    return createUserInDatabase(userId, payload.userData);
  }
});

// ✅ Deterministic task - safe with duplicate execution
const goodTask = task({
  name: "create-user",
  run({ payload }) {
    // Same input always produces same result
    const userId = generateIdFromEmail(payload.email); // Deterministic
    return createUserInDatabase(userId, payload.userData);
  }
});
```

#### **2. Idempotent Operations**
Since tasks may execute multiple times, they should be idempotent:

```typescript
// ✅ Idempotent task - safe to run multiple times
const sendEmail = task({
  name: "send-welcome-email",
  run({ payload }) {
    const { userId, email } = payload;
    
    // Check if email was already sent
    if (await hasEmailBeenSent(userId, "welcome")) {
      return { sent: false, reason: "already sent" };
    }
    
    // Send email and mark as sent
    await sendEmailToUser(email, welcomeTemplate);
    await markEmailAsSent(userId, "welcome");
    
    return { sent: true };
  }
});

// ✅ Idempotent payment processing
const processPayment = task({
  name: "process-payment",
  run({ payload }) {
    const { paymentId, amount } = payload;
    
    // Check if payment was already processed
    const existingPayment = await getPayment(paymentId);
    if (existingPayment && existingPayment.status === "completed") {
      return existingPayment;
    }
    
    // Process payment
    return processPaymentWithId(paymentId, amount);
  }
});
```

#### **3. Reliable Replay**
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

#### **4. Predictable State Recovery**
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

#### **5. Debugging and Testing**
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
6. **Duplicate Safety**: Tasks can be executed multiple times without side effects

By following these principles, your workflows become more reliable, easier to maintain, and more trustworthy in production environments where network issues, restarts, and retries are inevitable.

## Idempotency Keys

Idempotency keys provide an additional layer of protection against duplicate workflow and task executions. They allow you to safely retry operations without creating duplicates, even when the same request is sent multiple times.

### What are Idempotency Keys?

An idempotency key is a unique identifier that:
- Is provided by the client when enqueueing a workflow or task
- Is stored with the workflow/task execution
- Prevents duplicate executions when the same key is used
- Allows safe retries of failed operations

### Workflow Idempotency

When enqueueing workflows, you can provide an idempotency key to prevent duplicate workflow runs:

```typescript
// Enqueue a workflow with idempotency key
const resultHandle = await orderWorkflow.enqueue(client, {
  payload: { orderId: "order-123", items: [...] },
  idempotencyKey: "order-123-process" // Unique key for this order
});

// If this exact same call is made again with the same idempotency key,
// it will return the same workflow run instead of creating a duplicate
const duplicateHandle = await orderWorkflow.enqueue(client, {
  payload: { orderId: "order-123", items: [...] },
  idempotencyKey: "order-123-process" // Same key
});

// duplicateHandle.id === resultHandle.id (same workflow run)
```

### Task Idempotency

Tasks can also use idempotency keys to ensure they're only executed once:

```typescript
const sendEmail = task({
  name: "send-welcome-email",
  run({ payload, workflowRun }) {
    const { userId, email } = payload;
    
    // Use workflow run ID + task name as idempotency key
    const idempotencyKey = `${workflowRun.id}-send-welcome-email`;
    
    // Check if this exact task execution already completed
    const existingResult = await getTaskResult(idempotencyKey);
    if (existingResult) {
      return existingResult;
    }
    
    // Send email
    const result = await sendEmailToUser(email, welcomeTemplate);
    
    // Store result with idempotency key
    await storeTaskResult(idempotencyKey, result);
    
    return result;
  }
});
```

### Best Practices

#### **1. Make Keys Unique and Deterministic**
```typescript
// ✅ Good: Deterministic key generation
const createOrderKey = (orderId: string) => `order-${orderId}-process`;

// ❌ Bad: Non-deterministic key generation
const createOrderKey = () => `order-${Date.now()}-${Math.random()}`;
```

#### **2. Include Context in Keys**
```typescript
// ✅ Good: Include relevant context
const key = `user-${userId}-email-${emailType}-${timestamp}`;

// ❌ Bad: Too generic
const key = `send-email`;
```

### Benefits of Idempotency Keys

1. **Prevent Duplicates**: Ensure operations are only executed once
2. **Safe Retries**: Allow clients to retry failed requests without side effects
3. **Consistency**: Maintain data consistency even with network issues
4. **Audit Trail**: Track and debug duplicate attempts
5. **Performance**: Avoid unnecessary duplicate work

By implementing idempotency keys, you can build more robust workflows that handle the realities of distributed systems while maintaining data consistency and preventing duplicate operations.

## Determinism vs Idempotency Keys

You might wonder: if tasks are deterministic (same input → same output), why do we need idempotency keys? This is a great question that highlights the complementary nature of these two concepts.

### The Apparent Tension

There seems to be a logical conflict:
- **Determinism**: Same input always produces same output
- **Idempotency keys**: Same key skips execution, returns cached result

If tasks are truly deterministic, calling the same task twice with the same input should produce the same result anyway, making idempotency keys seem redundant.

### Why Both Concepts Are Valuable

#### **1. Performance Optimization**
Even deterministic tasks can be expensive to execute:

```typescript
const expensiveTask = task({
  name: "fetch-user-data",
  run({ payload }) {
    // Deterministic but expensive - database queries, API calls
    return fetchUserFromDatabase(payload.userId);
  }
});

// Without idempotency: Executes twice, makes two DB calls
await expensiveTask.run(workflowRun, { payload: { userId: "123" } });
await expensiveTask.run(workflowRun, { payload: { userId: "123" } });

// With idempotency: Executes once, caches result
await expensiveTask.run(workflowRun, { 
  payload: { userId: "123" }, 
  idempotencyKey: "user-123" 
});
await expensiveTask.run(workflowRun, { 
  payload: { userId: "123" }, 
  idempotencyKey: "user-123" 
});
```

#### **2. External Side Effects**
Deterministic tasks might still have external side effects:

```typescript
const sendEmail = task({
  name: "send-email",
  run({ payload }) {
    // Deterministic: Same input always produces same result
    // But we don't want to send the email twice!
    return sendEmailToUser(payload.email, payload.content);
  }
});

// First call: Actually sends email
await sendEmail.run(workflowRun, { 
  payload: { email: "user@example.com", content: "Welcome!" },
  idempotencyKey: "welcome-email-user-123"
});

// Second call: Returns cached result, doesn't send duplicate email
await sendEmail.run(workflowRun, { 
  payload: { email: "user@example.com", content: "Welcome!" },
  idempotencyKey: "welcome-email-user-123"
});
```

#### **3. Different Intent with Same Input**
Sometimes you want the same task executed multiple times for different reasons:

```typescript
// First call: Send welcome email
await sendEmail.run(workflowRun, { 
  payload: { email: "user@example.com", content: "Welcome!" },
  idempotencyKey: "welcome-email-user-123"
});

// Second call: Send reminder email (same email, different intent)
await sendEmail.run(workflowRun, { 
  payload: { email: "user@example.com", content: "Welcome!" },
  idempotencyKey: "reminder-email-user-123" // Different key = different execution
});
```

#### **4. Separation of Concerns**
The two concepts serve different purposes:

```typescript
const calculateTax = task({
  name: "calculate-tax",
  run({ payload }) {
    // Deterministic: Same input always produces same output
    return { tax: payload.amount * 0.1 };
  }
});

// Both calls would produce the same result, but:
// - First call: Actually executes the calculation
// - Second call: Returns cached result (performance optimization)
await calculateTax.run(workflowRun, { 
  payload: { amount: 100 }, 
  idempotencyKey: "tax-calculation-100" 
});
await calculateTax.run(workflowRun, { 
  payload: { amount: 100 }, 
  idempotencyKey: "tax-calculation-100" 
});
```

### Design Philosophy

This design follows the principle of **separation of concerns**:

- **Determinism**: Ensures task logic is predictable, testable, and reliable
- **Idempotency keys**: Control execution behavior and optimize performance

It's similar to memoization in functional programming - the function is pure and deterministic, but we cache results for performance.

### Best Practices

#### **When to Use the Same Idempotency Key**
- Identical task calls where you want to avoid duplicate work
- Expensive operations that produce the same result
- Operations with external side effects you want to prevent

#### **When to Use Different Idempotency Keys**
- Same task called for different purposes/intents
- When you want to force re-execution even with same input
- Testing or debugging scenarios

#### **When to Skip Idempotency Keys**
- Simple, fast tasks where overhead isn't worth it
- Tasks that should always execute (like logging)
- When you want to ensure fresh execution every time

### Summary

Determinism and idempotency keys are complementary concepts:
- **Determinism** ensures your task logic is reliable and predictable
- **Idempotency keys** give you control over execution behavior and performance

Together, they provide the foundation for building robust, efficient, and maintainable workflows that can handle the complexities of distributed systems.

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