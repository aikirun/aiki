<p align="center">
  <img src="docs/assets/aiki-logo-combo.svg" alt="Aiki" height="80">
</p>

<p>
  <img src="https://img.shields.io/badge/status-alpha-orange" alt="Status">
  <a href="https://www.npmjs.com/org/aikirun"><img src="https://img.shields.io/npm/v/@aikirun/workflow?label=npm" alt="npm version"></a>
  <a href="https://discord.aiki.run"><img src="https://img.shields.io/badge/discord-join-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="License"></a>
</p>

**A durable execution platform.**

Durable execution is a fault-tolerant paradigm for building applications, especially long-running workflows. Some workflows take minutes, others take days, months or years. They wait on humans, survive crashes, retry on failure, and coordinate across systems. Building these with traditional code means wiring together message queues, crons, state machines, and fragile recovery logic.

With Aiki, workflows are plain TypeScript. The platform makes them durable: each workflow is a virtual thread of execution that can be suspended intentionally or due to crashes/intermittent failures, and automatically resumed from where it left off.

Aiki's architecture is a server that orchestrates, and workers or endpoints that execute — shipped as a library. Run everything in a single process, or pull the components apart as you grow. Where each component runs is configuration, not architecture; workflow code never changes.

## Example: Subscription Trial

A workflow that activates a 14-day free trial and waits for the user to pay. If payment arrives early, it completes immediately. If the trial expires, the user is downgraded.

```typescript
import { event, task, workflow } from "@aikirun/workflow";

const activateTrial = task({
  name: "activate-trial",
  async handler(userId: string) { /**/ },
});

const downgradeToFree = task({
  name: "downgrade-to-free",
  async handler(userId: string) { /**/ },
});

export const trialV1 = workflow({ name: "subscription-trial" }).v("1.0.0", {
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
```

Behind this code, the workflow is persisted at every step: it survives crashes and waits out the 14 days without holding any system resources.

## Quick Start

The Aiki server is a library: `server({ db })` returns a fetch API HTTP handler `(Request) => Promise<Response>` and a background runtime. Mount the handler in any HTTP server — in the same process as your app, or in a process dedicated to Aiki. The example below runs everything in one process.

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
const aikiServer = server({ db: database({ provider: "pg", url: databaseUrl }) });
const runtimeHandle = await aikiServer.runtime.start();

const aikiClient = client({ handler: aikiServer.handler });
const workerHandle = await worker({ workflows: [trialV1] }).spawn(aikiClient);

// Start the workflow
const handle = await trialV1.start(aikiClient, { userId: "user-123" });

// Simulate the payment arriving
await handle.events.paymentReceived.send();
await handle.waitForStatus("completed");

await workerHandle.stop();
await runtimeHandle.stop();
```

Run it:

```bash
npx tsx app.ts   # or: bun run app.ts
```

The trial activates, the payment event ends the 14-day wait early, and the run completes.

Above, the client invokes `aikiServer.handler` directly — no network hop. If the server runs in a different process, point the client at it with `client({ url: "https://..." })`. Workflow code is unchanged.

### Bundled standalone server + dashboard

Prefer to run the server in its own process with a web dashboard? The repo ships a standalone server (`app/server`) and dashboard (`app/dashboard`) in a `docker-compose.yml`:

```bash
git clone https://github.com/aikirun/aiki.git && cd aiki

# Create a .env with your DATABASE_URL, then:
docker-compose up -d

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
| **Durable Execution** | Workflows survive crashes and resume from the last checkpoint |
| **Workflow Versioning** | Ship new workflow versions without breaking in-flight runs |
| **Flexible Topology** | One process or many — split the server, workers, and endpoints apart with a config change, not a rewrite |
| **Workers or Serverless** | Long-lived workers, or push-based endpoints for serverless platforms |
| **Child Workflows** | Modular, reusable sub-workflows that run in parallel on other workers |
| **Typed Events** | Wait for external signals with full TypeScript support; waiting releases the worker until the event arrives |
| **Event Timeouts** | Set deadlines for human responses |
| **Durable Sleep** | Sleep for days, months, or years without blocking workers |
| **Scheduled & Recurring Runs** | Cron and interval-based workflow schedules |
| **Retries** | Failed tasks retry on the policy you configure |
| **Idempotency** | Attach your own IDs to correlate runs with your data; duplicate submits return the existing run |
| **Horizontal Scaling** | Add workers; Aiki distributes work automatically |

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
│             Orchestrates runs, persists state in your database              │
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

You choose where each component runs: everything in one process, a central server with distributed workers, or push-based execution on serverless functions. Workflow code stays the same.

## Documentation

- **[Getting Started](./docs/README.md#-getting-started)** — Install, set up, and build your first workflow
- **[Core Concepts](./docs/README.md#-core-concepts)** — Workflows, tasks, events, schedules, workers, and the client
- **[Guides](./docs/README.md#-guides)** — Determinism, retries, refactoring, reference IDs, and reliable hooks
- **[Architecture](./docs/README.md#-architecture)** — How orchestration, state, and work discovery fit together
- **[Examples](./examples/src/workflows)** — Runnable workflows
- **[llms.txt](https://aiki.run/llms.txt)** — Docs index for AI agents and LLMs

## Requirements

- **Runtime**: Node.js 18+ or Bun 1.0+
- **Modules**: ESM only (`import`/`export`); CommonJS is not supported
- **Database**: PostgreSQL 14+ (SQLite and MySQL coming soon)

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

## Community

Aiki is in alpha — APIs may change between releases. Feedback shapes where it goes:

- [Discord](https://discord.aiki.run) — questions, feedback, and discussion
- [GitHub Issues](https://github.com/aikirun/aiki/issues) — bugs and feature requests

## License

Apache 2.0 — see [LICENSE](LICENSE)
