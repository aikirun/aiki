# Core Concepts

This document provides a detailed explanation of Aiki's core concepts and how they work together.

## Workflows

A workflow is a business process composed of multiple tasks. Workflows are versioned and can be updated over time.

### Workflow Definition

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

### Workflow Properties

- **name**: Unique identifier for the workflow
- **version**: Semantic versioning (e.g., "1.0.0", "2.1.0")
- **run**: The main workflow function that orchestrates tasks
- **trigger** (optional): Defines when the workflow should start

### Workflow Versioning

Workflows support versioning to allow for updates and migrations:

```typescript
// Version 1.0.0
const workflowV1 = workflow({
  name: "user-onboarding",
  version: "1.0.0",
  async run({ workflowRun }) {
    await sendWelcomeEmail.run(workflowRun, { payload: { userId: workflowRun.params.payload.userId } });
  }
});

// Version 2.0.0 with additional step
const workflowV2 = workflow({
  name: "user-onboarding",
  version: "2.0.0",
  async run({ workflowRun }) {
    await sendWelcomeEmail.run(workflowRun, { payload: { userId: workflowRun.params.payload.userId } });
    await createUserProfile.run(workflowRun, { payload: { userId: workflowRun.params.payload.userId } });
  }
});
```

## Tasks

Tasks are the building blocks of workflows. Each task represents a single unit of work that can be retried independently.

### Task Definition

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

### Task Properties

- **name**: Unique identifier for the task
- **run**: The function that performs the actual work
- **retry** (optional): Retry configuration for failed executions

### Task Execution Context

The `run` function receives a context object with:

- **payload**: The input data for the task
- **workflowRun**: Reference to the current workflow run
- **attempt**: Current attempt number (for retries)

```typescript
const processPayment = task({
  name: "process-payment",
  run({ payload, workflowRun, attempt }) {
    console.log(`Processing payment attempt ${attempt} for workflow ${workflowRun.id}`);
    return processPaymentWithId(payload.paymentId, payload.amount);
  }
});
```

## Workflow Runs

A workflow run is an instance of a workflow execution. It tracks the state, progress, and results of a specific workflow execution.

### Workflow Run States

- **pending**: Workflow is queued but not yet started
- **running**: Workflow is currently executing
- **completed**: Workflow finished successfully
- **failed**: Workflow encountered an error and failed
- **cancelled**: Workflow was cancelled

### Workflow Run Lifecycle

```typescript
// Create a workflow run
const resultHandle = await workflow.enqueue(client, {
  payload: { userId: "123", email: "user@example.com" }
});

// Check status
const status = await resultHandle.getStatus();
console.log(`Workflow ${status.id} is ${status.state}`);

// Wait for completion
const result = await resultHandle.waitForCompletion();
console.log("Workflow completed with result:", result);
```

## Workers

Workers are processes that execute workflows in your own environment and infrastructure. They poll the queue for available workflow runs and execute them locally.

### Worker Configuration

```typescript
import { worker } from "@aiki/sdk/worker";

const workerInstance = await worker(client, {
  id: "worker-1",
  maxConcurrentWorkflowRuns: 5,
  workflowRunSubscriber: {
    pollIntervalMs: 100,
    maxBatchSize: 10,
    maxRetryDelayMs: 30000
  },
  workflowRun: {
    heartbeatIntervalMs: 30000
  },
  gracefulShutdownTimeoutMs: 5000
});
```

### Worker Properties

- **id**: Unique identifier for the worker
- **maxConcurrentWorkflowRuns**: Maximum number of workflows to execute simultaneously
- **workflowRunSubscriber**: Configuration for polling workflow runs
- **workflowRun**: Configuration for workflow execution
- **gracefulShutdownTimeoutMs**: Time to wait for workflows to complete during shutdown

### Worker Registry

Workers maintain a registry of workflows they can execute:

```typescript
workerInstance.registry
  .add(morningRoutineWorkflow)
  .add(eveningRoutineWorkflow)
  .add(onboardingWorkflow);
```

### Worker Lifecycle

```typescript
// Start the worker
await workerInstance.start();

// Worker is now polling for workflow runs and executing them

// Stop the worker gracefully
await workerInstance.stop();
```

## Aiki Server

The Aiki Server is responsible for orchestrating workflows and communicating with workers. It manages workflow state, handles workflow enqueueing, and coordinates with the queue system.

### Server Responsibilities

- **Workflow Management**: Store and manage workflow definitions
- **State Persistence**: Maintain workflow run state and history
- **Queue Coordination**: Distribute workflow runs to workers
- **Monitoring**: Track workflow and task execution status

### Server Components

- **Workflow Orchestration**: Manages workflow lifecycle
- **Task Management**: Handles task state and results
- **Storage Layer**: Persists workflow runs, tasks, and metadata

## Queue System

The queue system stands between the Aiki Server and workers, managing the distribution of workflow runs.

### Queue Features

- **Reliable Delivery**: Ensures workflow runs are delivered to workers
- **Load Balancing**: Distributes work across multiple workers
- **Retry Logic**: Handles failed deliveries and retries
- **Message Persistence**: Survives server restarts

## Storage

The storage layer behind the Aiki Server persists workflow and task state, execution history, and metadata.

### Stored Data

- **Workflow Definitions**: Versioned workflow specifications
- **Workflow Runs**: Execution instances and their state
- **Task Results**: Individual task execution results
- **Metadata**: Timestamps, relationships, and audit information

### Storage Benefits

- **Durability**: Workflows survive server restarts and crashes
- **Audit Trail**: Complete history of workflow executions
- **Debugging**: Ability to inspect past executions
- **Analytics**: Data for monitoring and optimization

## Client

The client provides access to workflow operations like enqueueing new workflow runs and managing workflow execution.

### Client Operations

```typescript
import { createClient } from "@aiki/sdk/client";

const client = await createClient({ url: "localhost:9090" });

// Enqueue a workflow run
const resultHandle = await workflow.enqueue(client, {
  payload: { userId: "123" },
  idempotencyKey: "user-123-onboarding"
});

// Get workflow run status
const status = await resultHandle.getStatus();

// Wait for completion
const result = await resultHandle.waitForCompletion();
```

### Client Features

- **Workflow Enqueueing**: Start new workflow executions
- **Status Monitoring**: Check workflow run status
- **Result Retrieval**: Get workflow execution results
- **Idempotency Support**: Prevent duplicate workflow runs 