---
title: Context
description: Inject per-execution context — trace IDs, request metadata — into workflow runs, typed end to end.
---

Use `Context` for data that should be unique per workflow execution, like trace IDs or request metadata. You supply a `context` function on the client; it is called before each workflow execution — it may be sync/async — and the result is available to the handler as `run.context`.

Bind the `Context` type once on `workflow()` and `client()`; `run.context` is then typed automatically.

```typescript
import { workflow } from "@aikirun/workflow";
import { client } from "@aikirun/client";

interface Context {
	traceId: string;
	userId?: string;
}

// Bind Context at the workflow factory — run.context is typed for free
const auditWorkflow = workflow<Context>({ name: "audit" });

const auditWorkflowV1 = auditWorkflow.v("1.0.0", {
	async handler(run, input: { action: string }) {
		run.logger.info("Audit entry recorded", {
			traceId: run.context.traceId,
			userId: run.context.userId,
			action: input.action,
		});
		// ...
	},
});

// The client is typed with the same Context and supplies the factory
const aikiClient = client<Context>({
	url: "http://localhost:9850",
	context: (run) => ({
		traceId: crypto.randomUUID(),
	}),
});
```

Context is for values created fresh per execution. For dependencies created once at startup and shared by every execution — database connections, API clients, services — use higher-order functions instead; see [Dependency Injection](/docs/guides/dependency-injection).

## Next Steps

- **[Dependency Injection](/docs/guides/dependency-injection)** - Inject startup dependencies into workflows and tasks
- **[Logging](/docs/guides/logging)** - Log from workflow code with run-scoped metadata
- **[Client](/docs/core-concepts/client)** - Client configuration, including `context`
