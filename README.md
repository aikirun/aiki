# Aiki (This is still work in progress)

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
npm install @aiki/task @aiki/workflow @aiki/client @aiki/worker
```

Here's an example user onboarding workflow spanning multiple days. Traditional job queues would struggle with this. Aiki makes it trivial with durable state, event-driven waits, and automatic crash recovery.

*Workflow definition `workflow.ts`*
```typescript
import { workflow } from "@aiki/workflow";
import {createUserProfile, sendVerificationEmail, deactivateUser, markUserVerified, sendUsageTips} from "./task.ts";

export const onboardingWorkflow = workflow({ name: "user-onboarding" });

export const onboardingWorkflowV1 = onboardingWorkflow.v("1.0", {
  async exec(input: { email: string }, run) {

    const { userId } = await createUserProfile.start(run, {email: input.email});

    await sendVerificationEmail.start(run, {email: input.email});

    // Workflow pauses here until user clicks verification link - could be seconds or hours.
    // No resources consumed while waiting. If server crashes, resumes from this exact point.
    const event = await run.waitForEvent("email_verified", {timeout: { hours: 12 }});
    
    if (!event.received) {
      await deactivateUser.start(run, {
        userId,
        reason: "email not verified"
      });

      return { success: false };
    }

    await markUserVerified.start(run, { userId });

    // Sleeps for 24 hours without blocking workers or tying up resources.
    // If the server restarts during this time, workflow resumes exactly where it left off.
    await run.sleep({ days: 1 });

    await sendUsageTips.start(run, {email: input.email});

    return { success: true, userId };
  }
});
```

*Setup worker `setup.ts`*
```typescript
import { client } from "@aiki/client";
import { worker } from "@aiki/worker";
import { onboardingWorkflow } from "./workflow.ts";

export const aikiClient = await client({
  url: "localhost:9090",
  redis: { host: "localhost", port: 6379 }
});

const aikiWorker = await worker(aikiClient, {
  subscriber: { type: "redis_streams" }
});

aikiWorker.registry.add(onboardingWorkflow);

// This worker can process workflows alongside other workers - Aiki handles distribution.
// Scale horizontally by launching more workers pointing to the same Redis instance.
await aikiWorker.start();
```

*Start workflow `main.ts`*
```typescript
import { aikiClient } from "./setup.ts";
import { onboardingWorkflowV1 } from "./workflow.ts";

await onboardingWorkflowV1.start(aikiClient, {
  email: "newuser@example.com"
});
```

<details>
<summary>Task definitions <code>task.ts</code> (click to expand)</summary>

```typescript
import { task } from "@aiki/task";

export const createUserProfile = task({
  name: "create-profile",
  exec(input: { email: string }) {
    const id = db.users.create({
      email: input.email,
      status: "pending_verification"
    });
    return { userId: id};
  }
});

export const sendVerificationEmail = task({
  name: "send-verification",
  exec(input: { email: string }) {
    return emailService.sendVerification(input.email);
  }
}).withOptions({
  // If email sending fails it is retried up to 5 times with exponential backoff.
  // If the worker crashes mid-retry, on recovery Aiki detects it and continues from the last attempt.
  retry: {
    type: "exponential",
    maxAttempts: 5,
    baseDelayMs: 1000,
    maxDelayMs: 30000
  }
});

export const deactivateUser = task({
  name: "deactivate-user",
  exec(input: { userId: string; reason: string }) {
    return db.users.update({
      where: { id: input.userId },
      data: { status: "deactivated", deactivationReason: input.reason }
    });
  }
});

export const markUserVerified = task({
  name: "mark-verified",
  exec(input: { userId: string }) {
    return db.users.update({
      where: { id: input.userId },
      data: { status: "active" }
    });
  }
});

export const sendUsageTips = task({
  name: "send-usage-tips",
  exec(input: { email: string }) {
    return emailService.sendFeatures(input.email, {
      features: ["Advanced analytics"]
    });
  }
});
```

</details>

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

## Requirements

- **Server**: Deno 1.30+
- **Redis**: 6.2+ (for Redis Streams)
- **Database**: PostgreSQL 14+ (for state persistence)

## License

Apache 2.0 - see [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for details.
