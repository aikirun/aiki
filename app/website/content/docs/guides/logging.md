---
title: Logging
description: Plug your own logger into Aiki and log from workflow code with run-scoped metadata.
---

Aiki logs through a single `Logger` you can replace. The default is a built-in console logger that prints one JSON line per entry, at `info` and above.

## The Logger Contract

```typescript
interface Logger {
	trace(message: string, metadata?: Record<string, unknown>): void;
	debug(message: string, metadata?: Record<string, unknown>): void;
	info(message: string, metadata?: Record<string, unknown>): void;
	warn(message: string, metadata?: Record<string, unknown>): void;
	error(message: string, metadata?: Record<string, unknown>): void;
	child(bindings: Record<string, unknown>): Logger;
}
```

Pass your implementation to the client; every component built from that client — workers, endpoints, workflow runs — logs through it. The server takes its own, since it may run in a process with no client, and so does the database, which logs Postgres notices and warnings:

```typescript
const aikiClient = client({ url: "http://localhost:9850", logger: myLogger });
const db = database({ provider: "pg", url: databaseUrl }, { logger: myLogger });
const aikiServer = server({ db, logger: myLogger });
```

## The Built-in Console Logger

`consoleLogger()` builds the default logger with your own settings. It is exported from `@aikirun/client` and `@aikirun/server`:

```typescript
import { client, consoleLogger } from "@aikirun/client";

const logger = consoleLogger({ level: "warn", pretty: true });
const aikiClient = client({ url: "http://localhost:9850", logger });
```

| Option | Default | Description |
|--------|---------|-------------|
| `level` | `"info"` | The lowest level that is printed: `"trace"`, `"debug"`, `"info"`, `"warn"` or `"error"` |
| `pretty` | `false` | Print coloured, multi-line entries for reading in a terminal. `false` prints one JSON line per entry |

## Logging from Workflow Code

Inside a workflow handler, use `run.logger`. It is a child of the client's logger, pre-bound with the workflow's name, version, and run ID — so your application lines land next to Aiki's lifecycle lines for the same run, already correlated:

```typescript
const paymentWorkflowV1 = paymentWorkflow.v("1.0.0", {
	async handler(run, input: { orderId: string }) {
		const payment = await chargeCard.start(run, { orderId: input.orderId });

		run.logger.info("Payment authorized", {
			orderId: input.orderId,
			amountCents: payment.amountCents,
		});

		return payment;
	},
});
```

A workflow handler runs again from the start each time the run is [replayed](./determinism.md), for example after a sleep or an event wait. A line logged before that point is printed again on the replay. When a line must appear once, write it from a task.

Task handlers are plain functions and receive no logger. If a task needs one, inject it the way you inject any dependency — see [Dependency Injection](./dependency-injection.md).

## What Aiki Logs

At `info`, Aiki logs its components starting and stopping, and the rarer things that happen to a run, such as a pause, a cancel or a retry. The steps of each run - its start, tasks, waits and completion - are at `debug`. Problems are at `warn` and `error`. Aiki's metadata keys are namespaced under `aiki.*` (for example `aiki.workflowRunId`), so they do not collide with your fields, and errors are attached under the `err` key.

## Next Steps

- **[Context](./context.md)** - Per-execution context for workflow runs
- **[Dependency Injection](./dependency-injection.md)** - Inject services into workflows and tasks
- **[Client](../core-concepts/client.mdx)** - Client configuration, including `logger` and `context`
