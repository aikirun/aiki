# Dependency Injection

Aiki supports two patterns for injecting dependencies into your tasks and workflows. Choose based on when the dependency should be created.

## Higher-Order Functions (Compile-Time Dependencies)

Use this pattern for long-lived dependencies like database connections, API clients, or services that should be created once at startup and reused across all executions.

### Tasks

Wrap your task definition in a function that accepts dependencies:

```typescript
import { task } from "@aikirun/task";

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

## AppContext (Per-Execution Context)

Use `AppContext` for data that should be unique per workflow execution, like trace IDs or request metadata. The `createContext` function is called before each workflow execution.

```typescript
import { workflow } from "@aikirun/workflow";
import { client } from "@aikirun/client";

interface AppContext {
	traceId: string;
	workflowRunId: string;
	userId?: string;
}

// Workflow receives context as third parameter
const auditWorkflow = workflow({ name: "audit" });

const auditWorkflowV1 = auditWorkflow.v("1.0.0", {
	async handler(run, input: { action: string }, context: AppContext) {
		run.logger.info("Processing action", {
			traceId: context.traceId,
			userId: context.userId,
			action: input.action,
		});
		// ...
	},
});

// Client is typed with AppContext
const aikiClient = await client<AppContext>({
	url: "http://localhost:9850",
	redis: { host: "localhost", port: 6379 },
	createContext: (run) => ({
		traceId: crypto.randomUUID(),
		workflowRunId: run.id,
	}),
});
```

## When to Use Which

| Pattern | Use Case | Lifetime |
|---------|----------|----------|
| **Higher-order functions** | Database connections, API clients, services | Created once at startup |
| **AppContext** | Trace IDs, request metadata, user context | Created per execution |

**Higher-order functions** are best for:
- Dependencies that are expensive to create (DB connections, HTTP clients)
- Stateful services that should be shared
- External service clients with connection pooling

**AppContext** is best for:
- Per-request tracing and observability
- User-specific context that varies per execution
- Lightweight metadata that doesn't need connection management

## Next Steps

- **[Tasks](../core-concepts/tasks.md)** - Task definition and execution
- **[Workflows](../core-concepts/workflows.md)** - Workflow orchestration
- **[Retry Strategies](./retry-strategies.md)** - Configure automatic retries
