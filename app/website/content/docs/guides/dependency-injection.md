---
title: Dependency Injection
---

Inject dependencies that are created once at startup and shared by every execution — database connections, API clients, services — into tasks and workflows with higher-order functions. For values created fresh per execution, like trace IDs, use [Context](/docs/guides/context) instead.

## Higher-Order Functions (Startup Dependencies)

Use this pattern for dependencies like database connections, API clients, or services that should be created once at startup and reused across all executions.

### Tasks

Wrap your task definition in a function that accepts dependencies:

```typescript
import { task } from "@aikirun/workflow";

interface EmailService {
	send(to: string, subject: string, body: string): Promise<void>;
}

const createNotifyCustomer = (emailService: EmailService) =>
	task({
		name: "notify-customer",
		async handler(input: { email: string; message: string }) {
			await emailService.send(input.email, "Order Update", input.message);
		},
	});

// At startup, inject your real service:
const emailService = new SendGridEmailService(process.env.SENDGRID_API_KEY);
export const notifyCustomer = createNotifyCustomer(emailService);
```

### Workflows

The same pattern works for workflows:

```typescript
import { workflow } from "@aikirun/workflow";

interface Database {
	orders: {
		findById(id: string): Promise<Order>;
		update(id: string, data: Partial<Order>): Promise<void>;
	};
}

const createOrderWorkflow = (db: Database) => {
	const orderWorkflow = workflow({ name: "order-processing" });

	return orderWorkflow.v("1.0.0", {
		async handler(run, input: { orderId: string }) {
			const order = await db.orders.findById(input.orderId);

			// Process order...

			await db.orders.update(input.orderId, { status: "completed" });
			return { success: true };
		},
	});
};

// At startup:
const db = createDatabaseConnection(process.env.DATABASE_URL);
export const orderWorkflowV1 = createOrderWorkflow(db);
```

## When to Use Which

| Pattern | Use Case | Lifetime |
|---------|----------|----------|
| **Higher-order functions** | Database connections, API clients, services | Created once at startup |
| **[Context](/docs/guides/context)** | Trace IDs, request metadata, user context | Created per execution |

**Higher-order functions** are best for:
- Dependencies that are expensive to create (DB connections, HTTP clients)
- Stateful services that should be shared
- External service clients with connection pooling

**Context** is best for:
- Per-request tracing and observability
- User-specific context that varies per execution
- Lightweight metadata that doesn't need connection management

## Next Steps

- **[Context](/docs/guides/context)** - Per-execution context for workflow runs
- **[Tasks](/docs/core-concepts/tasks)** - Task definition and execution
- **[Workflows](/docs/core-concepts/workflows)** - Workflow orchestration
- **[Retry Strategies](/docs/guides/retry-strategies)** - Configure automatic retries
