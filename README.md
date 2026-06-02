<p align="center">
  <img src="docs/assets/aiki-logo-combo.svg" alt="Aiki" height="80">
</p>

<p>
  <img src="https://img.shields.io/badge/status-alpha-orange" alt="Status">
  <br>
</p>

**A durable execution platform.**

Durable execution is a fault tolerant paradigm for building applications, especially long running workflows. 

Some workflows take minutes, others take days, months or years. They often need to wait for human interaction, survive crashes, retry on failure, and coordinate across systems. Building these with traditional code means coordinating message queues, crons, state machines, and fragile recovery logic. 

With Aiki, you focus on writing business logic and let the platform handle durability.

Aiki workflows are like a virtual thread of execution that can be suspended (intentionally or due to crashes/intermittent-failures) and automatically resumed from where they left off.

## Example: Subscription Trial

A workflow that activates a 14-day free trial and waits for the user to pay. If payment arrives early, it completes immediately. If the trial expires, the user is downgraded.

```typescript
import { event, task, workflow } from "@aikirun/workflow";

const activateTrial = task({
  name: "activate-trial",
  async handler(userId: string) { },
});

const downgradeToFree = task({
  name: "downgrade-to-free",
  async handler(userId: string) { },
});

export const trialV1 = workflow({ name: "subscription-trial" }).v("1.0.0", {
  async handler(run, input: { userId: string }) {
    await activateTrial.start(run, input.userId);

    // Wait up to 14 days — ends early if user pays
    const result = await run.events.paymentReceived.wait({ timeout: { days: 14 } });
    if (result.timeout) {
      await downgradeToFree.start(run, input.userId);
    }
  },
  events: {
    paymentReceived: event(),
  },
});
```

This is regular TypeScript. Behind it, Aiki makes the workflow durable: persisted at every step, resumable from any point, and free to wait without holding system resources.

## What Aiki handles automatically

- **Crash recovery** — Workflows resume from the last checkpoint, not the start.
- **Automatic retries** — Failed tasks retry on the policy you configure.
- **Event suspension** — Waiting on an event releases the worker until the event arrives.
- **Durable sleep** — Multi day/month/year waits cost nothing.
- **Horizontal scaling** — Add workers; Aiki distributes work automatically.
- **Parallel execution** — Child workflows run on different workers in parallel.

## Quick Start

The Aiki server is a library: `server({ db })` returns an HTTP handler (`(Request) => Promise<Response>`) and a background runtime. Mount the handler in any HTTP framework — in the same process as your app, or in a process dedicated to Aiki. The example below puts everything in one process.

Install the SDK packages:

```bash
npm install @aikirun/workflow @aikirun/client @aikirun/worker @aikirun/server
npm install --save-dev @aikirun/cli
```

Apply Aiki's schema migration to your Postgres database:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/aiki \
  npx aiki migrate apply --package server
```

Save the trial workflow above to `workflow.ts` (exported as `trialV1`), then bootstrap and run it:

```typescript
// app.ts
import { client } from "@aikirun/client";
import { database, server } from "@aikirun/server";
import { worker } from "@aikirun/worker";
import { trialV1 } from "./workflow";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://user:password@localhost:5432/aiki";

// Server and worker, both running in this process
const aiki = server({ db: database({ provider: "pg", url: databaseUrl }) });
const runtimeHandle = await aiki.runtime.start();

const aikiClient = client({ handler: aiki.handler });
const workerHandle = await worker({ workflows: [trialV1] }).spawn(aikiClient);

// Start the workflow
const handle = await trialV1.start(aikiClient, { userId: "user-123" });

// Simulate the payment arriving
await handle.events.paymentReceived.send();
await handle.waitForStatus("completed");

await workerHandle.stop();
await runtimeHandle.stop();
```

Above, the client invokes `aiki.handler` directly — no network hop. If the server runs in a different process, point the client at it with `client({ url: "https://..." })`. Workflow code is unchanged.

### Bundled standalone server + dashboard

The repo ships a standalone server (`app/server`) and a web dashboard (`app/dashboard`), packaged in `docker-compose.yml` for one-command startup:

```bash
git clone https://github.com/aikirun/aiki.git && cd aiki

# Configure DATABASE_URL in .env, then:
docker-compose up
# Server: http://localhost:9850 — Dashboard: http://localhost:9851
```

See the [Installation Guide](./docs/getting-started/installation.md) for env vars and configuration.

<br>
<p align="center">
  <img src="docs/assets/aiki-dashboard-demo.gif" alt="Aiki Dashboard Demo" width="800">
</p>

## Features

| Feature | Description |
|---------|-------------|
| **Durable Execution** | Workflows survive crashes and restarts |
| **Workers or Serverless** | Long-lived workers, or push-based endpoints for serverless platforms |
| **Child Workflows** | Modular, reusable sub-workflows |
| **Typed Events** | Wait for external signals with full TypeScript support |
| **Event Timeouts** | Set deadlines for human responses |
| **Durable Sleep** | Sleep for days without blocking workers |
| **Scheduled & Recurring Runs** | Cron and interval-based workflow schedules |
| **Retries** | Configure retry policies for failed tasks |
| **Idempotency** | Attach your own IDs to correlate runs with your data; duplicate submits return the existing run |
| **Library, not a binary** | Server is `(Request) => Response`; mount it in your app, a separate process, or the bundled standalone server |
| **Horizontal Scaling** | Add workers to distribute load |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Your Application                               │
│                    (Uses Aiki SDK to start workflows)                       │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Aiki Server                                    │
│              Orchestrates runs, persists state in Postgres                  │
│         Embedded in your process, or hosted as a standalone service         │
└─────────────────────┬─────────────────────────────────┬─────────────────────┘
                      │                                 │
                      │ Pull (Subscribers)              │ Push (HTTP)
                      ▼                                 ▼
        ┌──────────────────────────┐       ┌──────────────────────────┐
        │  Workers                 │       │  Endpoints               │
        │  Long-lived processes    │       │  Serverless functions    │
        │  in your infrastructure  │       │  on any platform         │
        └──────────────────────────┘       └──────────────────────────┘
```

Pick the deployment shape that fits your stack — everything in one process, a hosted central orchestrator with distributed workers, or push-based execution on serverless functions. Workflow code stays the same.

## Documentation

- **[Getting Started](./docs/getting-started/quick-start.md)** — Install, set up, and build your first workflow
- **[Core Concepts](./docs/core-concepts/)** — Workflows, tasks, events, schedules, workers, and the client
- **[Guides](./docs/guides/)** — Determinism, retries, refactoring, reference IDs, and reliable hooks
- **[Architecture](./docs/architecture/overview.md)** — How orchestration, state, and work discovery fit together
- **[Examples](./examples/src/workflows)** — Runnable workflows: fan-out, cancellation cascade, long-running pipeline, and more

## Requirements

- **Runtime**: Node.js 18+ or Bun 1.0+
- **Modules**: ESM only (`import`/`export`); CommonJS is not supported
- **Database**: PostgreSQL 14+

See the [Installation Guide](./docs/getting-started/installation.md) for detailed setup instructions including environment variable configuration.

## Packages

**Core** — what most projects install:

- [`@aikirun/workflow`](https://www.npmjs.com/package/@aikirun/workflow) — Define workflows and tasks
- [`@aikirun/client`](https://www.npmjs.com/package/@aikirun/client) — Typed connection to the Aiki server (embedded or hosted); workflows, workers, and schedules attach to it
- [`@aikirun/worker`](https://www.npmjs.com/package/@aikirun/worker) — Long-lived worker for pull-based execution
- [`@aikirun/server`](https://www.npmjs.com/package/@aikirun/server) — Embeddable server library
- [`@aikirun/cli`](https://www.npmjs.com/package/@aikirun/cli) — `aiki migrate` and related tooling

**Optional** — add when you need it:

- [`@aikirun/endpoint`](https://www.npmjs.com/package/@aikirun/endpoint) — Run workflows on serverless platforms via push instead of pull
- [`@aikirun/iam`](https://www.npmjs.com/package/@aikirun/iam) — Multi-tenancy, API keys, and dashboard auth
- [`@aikirun/redis`](https://www.npmjs.com/package/@aikirun/redis) — Sub-second timer dispatch and cross-host work distribution

## License

Apache 2.0 — see [LICENSE](LICENSE)
