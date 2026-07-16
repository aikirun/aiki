---
title: Logging
description: Plug your own logger into Aiki and log from workflow code with run-scoped metadata.
---

Aiki logs through a single `Logger` you can replace. The default is a built-in console logger at `INFO` level.

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

Pass your implementation to the client; every component built from that client — workers, endpoints, workflow runs — logs through it. The server takes its own, since it may run in a process with no client:

```typescript
const aikiClient = client({ url: "http://localhost:9850", logger: myLogger });
const aikiServer = server({ db, logger: myLogger });
```

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

Task handlers are plain functions and receive no logger. If a task needs one, inject it the way you inject any dependency — see [Dependency Injection](./dependency-injection.md).

## What Aiki Logs

The SDK logs run lifecycle (claims, execution, retries, heartbeats etc.) and component activity at `info` and below, with problems at `warn` and `error`. Aiki's metadata keys are namespaced under `aiki.*` (for example `aiki.workflowRunId`), so they do not collide with your fields, and errors are attached under the `err` key.

## Next Steps

- **[Context](./context.md)** - Per-execution context for workflow runs
- **[Dependency Injection](./dependency-injection.md)** - Inject services into workflows and tasks
- **[Client](../core-concepts/client.mdx)** - Client configuration, including `logger` and `context`
