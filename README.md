# Aiki

**A durable workflow engine for TypeScript that runs in your infrastructure.**

Build reliable, long-running business processes that survive failures, restarts, and infrastructure changes. Aiki separates workflow orchestration from execution, giving you durability without giving up control.

## Why Aiki?

- **🔄 Durable Execution** - Workflows survive crashes and restarts automatically
- **🚀 Horizontal Scaling** - Add workers to scale, with automatic work distribution
- **⚡ High Performance** - Redis Streams for fault-tolerant message distribution
- **🔒 Run in Your Environment** - Workers execute in your infrastructure, not ours
- **🎯 Type-Safe** - Full TypeScript support with end-to-end type safety
- **🛡️ Built-in Fault Tolerance** - Message claiming, automatic retries, graceful recovery

## Quick Start

```bash
# Install packages
npm install @aiki/client @aiki/worker @aiki/workflow @aiki/task
```

```typescript
import { client } from "@aiki/client";
import { task } from "@aiki/task";
import { worker } from "@aiki/worker";
import { workflow } from "@aiki/workflow";

// Define a task
const sendEmail = task({
  name: "send-email",
  exec(input: { email: string; message: string }) {
    return sendEmailTo(input.email, input.message);
  }
});

// Define a workflow
const onboardingWorkflow = workflow({ name: "user-onboarding" });

const onboardingV1 = onboardingWorkflow.v("1.0.0", {
  async exec(input: { email: string }, run) {
    await sendEmail.start(run, { email: input.email, message: "Welcome!" });
  }
});

// Set up client and worker
const aikiClient = await client({
  url: "localhost:9090",
  redis: { host: "localhost", port: 6379 }
});

const aikiWorker = await worker(aikiClient, {
  id: "worker-1",
  subscriber: { type: "redis_streams" }
});

aikiWorker.workflowRegistry.add(onboardingWorkflow);
await aikiWorker.start();

// Start a workflow
const result = await onboardingV1.start(aikiClient, { email: "user@example.com" });
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Your Application                               │
│                    (Uses Aiki SDK to start workflows)                       │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      │ SDK Client
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Aiki Server                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │  Workflow       │  │  Task           │  │  Storage Layer              │  │
│  │  Orchestration  │  │  Management     │  │  (Workflow Runs, Tasks,     │  │
│  │                 │  │                 │  │   Results, State)           │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      │ Redis Streams
                                      ▼
                     ┌───────────────────────────────────┐
                     │         Redis Cluster             │
                     │  ┌─────────────────────────────┐  │
                     │  │  Stream 1: workflow:orders  │  │
                     │  │  Stream 2: workflow:users   │  │
                     │  └─────────────────────────────┘  │
                     └───────────────────────────────────┘
                                      │
                                      │
                                      ▼
          ┌─────────────────────────────────────────────────────────┐
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
          └─────────────────────────────────────────────────────────┘
```

Aiki's server orchestrates workflows and manages state, while workers execute tasks in your environment. This separation gives you durability and observability without sacrificing control over where your code runs.

## Documentation

- **[Getting Started](./docs/getting-started/quick-start.md)** - Complete setup guide and first workflow
- **[Core Concepts](./docs/core-concepts/)** - Workflows, tasks, workers, and the client
- **[Architecture](./docs/architecture/)** - System design and how components interact
- **[Guides](./docs/guides/)** - Task determinism, idempotency, and best practices
- **[API Reference](./docs/api/)** - Complete API documentation

## Requirements

- **Server**: Deno 1.30+
- **Redis**: 6.2+ (for Redis Streams)
- **Database**: PostgreSQL 14+ (for state persistence)

## License

MIT - see [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for details.
