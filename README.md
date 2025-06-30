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

## Core Concepts

### Workflows
A workflow is a business process composed of multiple tasks. Workflows are versioned and can be updated over time.

### Tasks
Tasks are the building blocks of workflows. Each task represents a single unit of work that can be retried independently.

### Workers
Workers are processes that execute workflows in your own environment and infrastructure. This ensures your business logic runs in your controlled environment, not in Aiki's infrastructure.

### Aiki Server
The Aiki Server orchestrates workflows and manages state, but doesn't execute your code. It coordinates with workers through a queue system.

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
          │  │ Environment │  │ Environment │  │ Environment │     │
          │  └─────────────┘  └─────────────┘  └─────────────┘     │
          │                                                         │
          │                    Your Infrastructure                  │
          │              (Your servers, containers, etc.)           │
          └─────────────────────────────────────────────────────────┘
```

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

## Key Features

- **🔄 Durability**: Workflows survive server restarts and crashes
- **🚀 Scalability**: Horizontal scaling with multiple workers
- **🛡️ Reliability**: Built-in retry mechanisms and error handling
- **📊 Observability**: Track workflow and task execution status
- **🔧 Flexibility**: Cross-platform support (Node.js and Deno)
- **🔒 Security**: Execution in your own environment

## Documentation

For detailed documentation, see the [docs](./docs) directory:

- [Core Concepts](./docs/core-concepts.md) - Detailed explanation of workflows, tasks, and workers
- [Architecture](./docs/architecture.md) - Deep dive into Aiki's architecture and design
- [Task Determinism](./docs/task-determinism.md) - Why tasks should be deterministic
- [Idempotency](./docs/idempotency.md) - Using idempotency keys for reliable execution
- [Best Practices](./docs/best-practices.md) - Guidelines for building robust workflows

For complete API documentation, see the JSDoc comments in the source code.

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE) file for details. 