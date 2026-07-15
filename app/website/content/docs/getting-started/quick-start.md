---
title: Quick Start
---

Get a workflow running end to end in minutes.

## Prerequisites

- A Postgres database
- SDK packages installed and the schema migration applied — see [Installation](/docs/getting-started/installation)

## Code

Save the following as `app.ts` in your project — a workflow that activates a 14-day free trial and waits for the user to pay. If payment arrives early, it completes immediately. If the trial expires, the user is downgraded.

```typescript
import { client } from "@aikirun/client";
import { database, server } from "@aikirun/server";
import { worker } from "@aikirun/worker";
import { event, task, workflow } from "@aikirun/workflow";

const activateTrial = task({
  name: "activate-trial",
  async handler(userId: string) { /* your code */ },
});

const downgradeToFree = task({
  name: "downgrade-to-free",
  async handler(userId: string) { /* your code*/ },
});

const trialV1 = workflow({ name: "subscription-trial" }).v("1.0.0", {
  async handler(run, input: { userId: string }) {
    await activateTrial.start(run, input.userId);

    // Wait until payment is received or the 14-day trial expires
    const result = await run.events.paymentReceived.wait({ timeout: { days: 14 } });
    if (result.timeout) {
      await downgradeToFree.start(run, input.userId);
    }
  },
  events: {
    paymentReceived: event(),
  },
});

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://user:password@localhost:5432/aiki";

// Server and worker, both running in this process
const aikiServer = server({ db: database({ provider: "pg", url: databaseUrl }) });
const runtimeHandle = aikiServer.runtime.start();

const aikiClient = client({ handler: aikiServer.handler });
const workerHandle = worker({ workflows: [trialV1] }).spawn(aikiClient);

// Start the workflow
const handle = await trialV1.start(aikiClient, { userId: "user-123" });

// Simulate the payment arriving
await handle.events.paymentReceived.send();
await handle.waitForStatus("completed");

await workerHandle.stop();
await runtimeHandle.stop();
```

## Run

```bash
# Node.js with tsx
npx tsx app.ts

# or with Bun
bun run app.ts
```

The trial activates, the payment event ends the 14-day wait early, and the run completes.

> By default, `waitForStatus` waits indefinitely. To bound it, pass a timeout: `await handle.waitForStatus("completed", { timeout: { seconds: 60 } })`.

## What just happened?

1. **Task** — `activateTrial` and `downgradeToFree` are units of work; each result is persisted so a workflow doesn't redo it after a crash.
2. **Workflow** — `trialV1` orchestrates tasks and events. Its execution is tracked at every step.
3. **Event** — `paymentReceived.wait()` suspends the run without holding any resources; `handle.events.paymentReceived.send()` wakes it. If nothing arrives in 14 days, the wait times out instead.
4. **Server** — `server({ db })` creates the server; `runtime.start()` runs its background loops.
5. **Client** — `client({ handler })` connects to the server in-process. Workers and your application code both attach to it.
6. **Worker** — `worker({...}).spawn(client)` starts the worker which claims ready runs from the server and executes them.

Everything in this example lives in one process. The same workflow code runs against a separately deployed server — swap `client({ handler: aikiServer.handler })` for `client({ url: "..." })`.

## Next Steps

- **[Your First Workflow](/docs/getting-started/first-workflow)** — Build a multi-step workflow with events, child workflows, and durable sleep
- **[Workflows](/docs/core-concepts/workflows)** — Deep dive into workflow concepts
- **[Determinism](/docs/guides/determinism)** — Writing deterministic workflows
