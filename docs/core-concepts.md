# Core Concepts

Let me walk you through Aiki's core concepts step by step, starting with the basics and building up to more advanced
ideas.

## Workflows

Think of a workflow as a **recipe for a business process**. Just like a recipe tells you the steps to make a dish, a
workflow tells you the steps to complete a business operation. For example, processing an order might involve validating
the order, charging the customer, updating inventory, and sending a confirmation email.

Here's how you define a workflow in Aiki:

```typescript
import { workflow } from "@aiki/workflow";

const morningRoutineWorkflow = workflow({
	name: "morning-routine",
});

const morningRoutineV1 = morningRoutineWorkflow.v("1.0.0", {
	async run(ctx, payload: { duration?: number }) {
		const alarmResult = await ringAlarm.start(ctx, {
			payload: { song: "Wake up!" },
		});

		const stretchResult = await stretch.start(ctx, {
			payload: { duration: payload.duration || 300 },
		});

		return { alarmResult, stretchResult };
	},
});
```

The workflow function (`run`) orchestrates the individual steps, but it can contain any logic you need. While it often
calls tasks to perform specific operations, it can also include:

- **Conditional logic**: Different paths based on data or results
- **Data transformation**: Processing and transforming data between steps
- **Error handling**: Custom error handling and recovery logic
- **Business logic**: Any application-specific logic that doesn't need to be a separate task

Here's an example with more complex logic:

```typescript
const orderProcessingWorkflow = workflow({
	name: "order-processing",
});

const orderProcessingV1 = orderProcessingWorkflow.v("1.0.0", {
	async run(ctx, payload: { orderData: any }) {
		const { orderData } = payload;

		// Validate order
		const validation = await validateOrder.start(ctx, {
			payload: { orderData },
		});

		// Business logic: Check if order qualifies for discount
		let finalAmount = validation.amount;
		if (validation.amount > 100) {
			finalAmount = validation.amount * 0.9; // 10% discount
		}

		// Process payment with calculated amount
		const payment = await processPayment.start(ctx, {
			payload: { paymentId: validation.paymentId, amount: finalAmount },
		});

		// Conditional logic: Only update inventory if payment succeeded
		if (payment.success) {
			await updateInventory.start(ctx, {
				payload: { items: orderData.items },
			});

			// Send confirmation
			await sendConfirmation.start(ctx, {
				payload: { email: orderData.email, amount: finalAmount },
			});
		} else {
			// Handle payment failure
			await sendPaymentFailureNotification.start(ctx, {
				payload: { email: orderData.email, reason: payment.error },
			});
		}

		return { success: payment.success, orderId: validation.orderId };
	},
});
```

This separation is important because it allows each step to be retried independently if something goes wrong, while
still giving you the flexibility to include complex business logic in your workflows.

### Workflow Properties

Workflows in Aiki are created using a two-step process:

1. **Workflow Definition**: First, you create a workflow with just a name:
   ```typescript
   const myWorkflow = workflow({ name: "user-onboarding" });
   ```

2. **Workflow Versions**: Then, you create versioned implementations using the `.v()` method:
   ```typescript
   const myWorkflowV1 = myWorkflow.v("1.0.0", {
   	async run(ctx, payload) {
   		// Your workflow logic here
   	},
   });
   ```

**Key Properties:**

- **name**: A unique identifier for the workflow. Use descriptive names that clearly indicate what the workflow does,
  like "user-onboarding" or "order-processing".

- **version**: Specified when calling `.v()`, this follows semantic versioning (like "1.0.0", "2.1.0"). Versioning is
  essential because workflows can evolve over time, and you need to handle both old and new versions running
  simultaneously.

- **run**: This is the main function that orchestrates the workflow. It receives a context object and the payload, and
  returns the workflow result.

### Workflow Versioning

One of the most powerful features of Aiki is workflow versioning. This allows you to update workflows over time without
breaking existing processes. Here's how it works:

```typescript
// Create the workflow definition
const userOnboardingWorkflow = workflow({
	name: "user-onboarding",
});

// Version 1.0.0 - Simple user onboarding
const userOnboardingV1 = userOnboardingWorkflow.v("1.0.0", {
	async run(ctx, payload: { userId: string }) {
		await sendWelcomeEmail.start(ctx, {
			payload: { userId: payload.userId },
		});
	},
});

// Version 2.0.0 - Add profile creation step
const userOnboardingV2 = userOnboardingWorkflow.v("2.0.0", {
	async run(ctx, payload: { userId: string }) {
		await sendWelcomeEmail.start(ctx, {
			payload: { userId: payload.userId },
		});
		await createUserProfile.start(ctx, {
			payload: { userId: payload.userId },
		});
	},
});
```

When you deploy version 2.0.0, existing workflow runs continue with version 1.0.0, while new runs use version 2.0.0.
This gives you the flexibility to gradually migrate to new workflow versions.

## Tasks

Tasks are the building blocks of workflows. Each task represents a single unit of work that can be retried
independently. This is a fundamental concept because it allows you to handle failures gracefully.

Here's a simple task definition:

```typescript
import { task } from "@aiki/task";

const ringAlarm = task({
	name: "ring-alarm",
	run({ payload }) {
		// Your business logic here
		return Promise.resolve(payload.song);
	}
	// ⚠️ Note: Task-level retry configuration is not yet implemented.
	// Retry logic is currently handled at the workflow level.
	// retry: {
	//   type: "fixed",
	//   maxAttempts: 3,
	//   delayMs: 1000,
	// },
});
```

### Task Properties

- **name**: A unique identifier for the task. I recommend using descriptive names that clearly indicate what the task
  does.

- **run**: The function that performs the actual work. This is where your business logic goes.

- **retry**: Optional configuration for how the task should be retried if it fails. This is one of the key benefits of
  using Aiki - you get sophisticated retry logic without having to implement it yourself.

### Task Execution Context

The `run` function receives a context object with useful information:

- **payload**: The input data for the task
- **workflowRun**: A reference to the current workflow run

Here's an example that uses these:

```typescript
const processPayment = task({
	name: "process-payment",
	run({ payload, workflowRun }) {
		console.log(`Processing payment for workflow ${workflowRun.id}`);

		// You can access workflow-level data if needed
		const orderId = workflowRun.params.payload.orderId;

		return processPaymentWithId(payload.paymentId, payload.amount);
	},
});
```

## Workflow Runs

A workflow run is an **instance** of a workflow execution. Think of it like this: a workflow is the recipe, and a
workflow run is what happens when you actually follow that recipe to cook a meal.

### Workflow Run States

Workflow runs go through several states during their lifecycle:

- **pending**: The workflow is queued but not yet started
- **running**: The workflow is currently executing
- **completed**: The workflow finished successfully
- **failed**: The workflow encountered an error and failed
- **cancelled**: The workflow was cancelled (perhaps by a user or administrator)

### Working with Workflow Runs

Here's how you typically interact with workflow runs:

```typescript
// Start a workflow run
const resultHandle = await workflowVersion.start(client, {
	payload: { userId: "123", email: "user@example.com" },
});

// Check the status
const status = await resultHandle.getStatus();
console.log(`Workflow ${status.id} is ${status.state}`);

// Wait for completion
const result = await resultHandle.waitForCompletion();
console.log("Workflow completed with result:", result);
```

The `resultHandle` is a powerful abstraction that gives you a way to monitor and interact with a workflow run without
having to worry about the underlying implementation details.

## Workers

Workers are processes that execute workflows in your own environment and infrastructure. This is a key design decision
in Aiki - your business logic never leaves your controlled environment.

### Worker Configuration

Here's how you create and configure a worker:

```typescript
import { worker } from "@aiki/worker";

const workerInstance = await worker(client, {
	id: "worker-1",
	maxConcurrentWorkflowRuns: 5,
	subscriber: {
		type: "redis_streams",
		claimMinIdleTimeMs: 60_000,
		blockTimeMs: 1000
	},
	workflowRun: {
		heartbeatIntervalMs: 30000,
	},
	gracefulShutdownTimeoutMs: 5000,
});
```

Let me break down these configuration options:

- **id**: A unique identifier for the worker. This is useful for monitoring and debugging.

- **maxConcurrentWorkflowRuns**: How many workflows this worker can execute simultaneously. This is significant for
  resource management.

- **subscriber**: Configuration for how the worker receives workflow run notifications. Redis Streams is currently the only fully implemented subscriber strategy, providing high-performance message distribution with fault tolerance.

- **workflowRun**: Configuration for workflow execution, including how often to send heartbeats.

- **gracefulShutdownTimeoutMs**: How long to wait for active workflows to complete when shutting down the worker.

### Worker Registry

Workers maintain a registry of workflows they can execute. This is how the worker knows what workflows are available:

```typescript
workerInstance.workflowRegistry
	.add(morningRoutineWorkflow)
	.add(eveningRoutineWorkflow)
	.add(onboardingWorkflow);
```

The registry pattern here is valuable because it allows you to have different workers handle different types of
workflows. For example, you might have one worker for payment processing workflows and another for email workflows.

### Worker Lifecycle

Workers have a simple lifecycle:

```typescript
// Start the worker
await workerInstance.start();

// The worker is now polling for workflow runs and executing them
// Note: start() returns a Promise<void> that resolves when the worker stops

// Stop the worker gracefully
await workerInstance.stop();
```

The graceful shutdown is necessary because it ensures that active workflows have a chance to complete before the worker
stops.

## Aiki Server

The Aiki Server is responsible for orchestrating workflows and communicating with workers. It's the central coordination
point in the system.

### Server Responsibilities

The server has several key responsibilities:

- **Workflow Management**: Store and manage workflow definitions
- **State Persistence**: Maintain workflow run state and history
- **Queue Coordination**: Distribute workflow runs to workers
- **Monitoring**: Track workflow and task execution status

### Server Components

The server is composed of several components:

- **Workflow Orchestration**: Manages the lifecycle of workflows and workflow runs
- **Task Management**: Handles task state and results
- **Storage Layer**: Persists workflow runs, tasks, and metadata

The separation of these components is beneficial because it allows for different storage backends and scaling
strategies.

## Queue System

The queue system stands between the Aiki Server and workers, managing the distribution of workflow runs. This is a
critical piece of the architecture because it provides reliable message delivery.

### Queue Features

The queue system provides several key features:

- **Reliable Delivery**: Ensures workflow runs are delivered to workers even if there are temporary network issues
- **Load Balancing**: Distributes work across multiple workers
- **Retry Logic**: Handles failed deliveries with exponential backoff
- **Message Persistence**: Survives server restarts

## Storage

The storage layer behind the Aiki Server persists workflow and task state, execution history, and metadata. This is what
makes workflows durable - even if the server crashes, the state is preserved.

### Stored Data

The storage layer maintains several types of data:

- **Workflow Definitions**: Versioned workflow specifications
- **Workflow Runs**: Execution instances and their state
- **Task Results**: Individual task execution results
- **Metadata**: Timestamps, relationships, and audit information

### Storage Benefits

The storage layer provides several key benefits:

- **Durability**: Workflows survive server restarts and crashes
- **Audit Trail**: Complete history of workflow executions
- **Debugging**: Ability to inspect past executions
- **Analytics**: Data for monitoring and optimization

## Client

The client provides access to workflow operations like enqueueing new workflow runs and managing workflow execution.
It's the primary interface that your application uses to interact with Aiki.

### Client Operations

Here are the main operations you can perform with the client:

```typescript
import { client } from "@aiki/client";

const aikiClient = await client({
	baseUrl: "localhost:9090",
	redis: {
		host: "localhost",
		port: 6379
	}
});

// Start a workflow run
const resultHandle = await workflowVersion.start(aikiClient, {
	payload: { userId: "123" },
	idempotencyKey: "user-123-onboarding",
});

// Get workflow run status
const status = await resultHandle.getStatus();

// Wait for completion
const result = await resultHandle.waitForCompletion();
```

### Client Features

The client provides several valuable features:

- **Workflow Execution**: Start new workflow runs
- **Status Monitoring**: Check workflow run status
- **Result Retrieval**: Get workflow execution results
- **Idempotency Support**: Prevent duplicate workflow runs

The idempotency support is especially valuable for production systems where you need to ensure that the same operation
isn't performed multiple times.

## Putting It All Together

Now that we've covered all the core concepts, let me show you how they work together in a typical scenario:

1. **Your application** uses the client to start a workflow run
2. **The Aiki Server** receives the request and stores the workflow run in the storage layer
3. **The server** publishes a message to the queue system
4. **A worker** polls the queue and receives the workflow run
5. **The worker** loads the workflow definition from its registry
6. **The worker** executes the workflow, calling individual tasks
7. **Task results** are sent back to the server via the queue
8. **The server** updates the workflow state in storage
9. **Your application** can monitor progress and retrieve results

This architecture provides several key benefits:

- **Reliability**: Each component can fail independently without affecting the others
- **Scalability**: You can add more workers to handle increased load
- **Observability**: Every step is tracked and can be monitored
- **Flexibility**: You can deploy workers in different environments and regions

The key insight is that by separating orchestration from execution, you get a system that's both more reliable and more
flexible than traditional approaches.
