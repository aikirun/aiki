# Reference IDs

Reference IDs let you assign custom identifiers to workflows, tasks, and events. This enables tracking, correlation with your systems, and lookup by your own IDs. As a secondary benefit, reference IDs prevent duplicate executions when the same reference is reused.

## What are Reference IDs?

A reference ID is a custom identifier you provide when starting a workflow, task, or sending an event. Use cases include:

- **Tracking**: Correlate Aiki workflows with your order IDs, user IDs, or transaction IDs
- **Lookup**: Find a workflow run using your own identifier instead of Aiki's internal run ID
- **Duplicate prevention**: When a reference ID is reused, Aiki can either throw an error, return the existing run, or silently deduplicate (for events)

Reference IDs are unique per workflow version (workflow name + version ID). The same reference ID can be used across different workflow versions without conflict.

## Workflow Reference IDs

When starting workflows, you can provide a reference ID:

```typescript
// Start a workflow with a reference ID
const handle = await orderWorkflowV1
  .with().opt("reference.id", "order-123")
  .start(client, { orderId: "order-123", items: [...] });

// You can now look up this workflow using "order-123"
// If you try to start another workflow with the same reference ID,
// Aiki will throw an error by default (configurable via conflictPolicy)
```

### Conflict Handling

By default, Aiki throws an error when you try to start a workflow with a reference ID that already exists but with different input. You can configure this behavior with the `conflictPolicy` option:

```typescript
// Default behavior: throw error on conflict
const handle = await orderWorkflowV1
  .with().opt("reference", { id: "order-123-process", conflictPolicy: "error" })
  .start(client, { orderId: "order-123", items: [...] });

// Alternative: return existing run on conflict
const handle = await orderWorkflowV1
  .with().opt("reference", { id: "order-123-process", conflictPolicy: "return_existing" })
  .start(client, { orderId: "order-123", items: [...] });

// With "return_existing", duplicate calls return the same workflow run
// handle.id will be the same as the original run
```

## Task Idempotency

Tasks within a workflow are **automatically idempotent** by default. When you run the same task with the same payload multiple times, it will only execute once and return the cached result:

```typescript
const sendEmail = task({
	name: "send-welcome-email",
	handler(input: { email: string }) {
		return sendEmailToUser(input.email, welcomeTemplate);
	},
});

// First call: Actually executes the task
await sendEmail.start(run, {
	email: "user@example.com",
});

// Second call with same input: Returns cached result, doesn't execute again
await sendEmail.start(run, {
	email: "user@example.com",
});

// To force re-execution, use a different reference ID
await sendEmail.with().opt("reference.id", "second-welcome").start(run, {
	email: "user@example.com",
});
```

Using a different reference ID creates a separate execution context, bypassing the cached result.

## Event Reference IDs

When sending events to a workflow, you can provide a reference ID to prevent duplicate event delivery:

```typescript
// Send an event with a reference ID
await handle.events.approved
  .with()
  .opt("reference.id", "approval-123")
  .send({ by: "manager@example.com" });

// If the same event is sent again with the same reference ID,
// it will be silently ignored (no error, no duplicate)
await handle.events.approved
  .with()
  .opt("reference.id", "approval-123")
  .send({ by: "manager@example.com" }); // Ignored - duplicate

// Without options, use send directly
await handle.events.approved.send({ by: "manager@example.com" });
```

Unlike workflows and tasks, events use **silent deduplication** - duplicate events are simply ignored rather than throwing an error.

## Schedule Reference IDs

When activating schedules, you can provide a reference ID for explicit identity:

```typescript
const handle = await dailyReport
	.with()
	.opt("reference", {
		id: "tenant-acme-daily-report",
		conflictPolicy: "error",
	})
	.activate(client, reportWorkflowV1, { tenantId: "acme" });
```

Schedule conflict policies differ from workflows:

| Policy | Behavior |
|--------|----------|
| `"upsert"` (default) | Update existing schedule if parameters differ |
| `"error"` | Throw error if parameters differ from existing |

With `"upsert"`, re-activating a schedule with different timing or input updates it. With `"error"`, it throws a `ScheduleConflictError` if the parameters don't match.

See the [Schedules documentation](../core-concepts/schedules.md#reference-ids) for more details.

## How It Works

### Workflow Level

When you provide a reference ID when starting a workflow, the system checks if a workflow run with that ID already exists. Based on the `conflictPolicy` setting:
- `"error"` (default): Throws an error if a run exists with different input
- `"return_existing"`: Returns the existing workflow run

### Task Level

Tasks within a workflow are automatically idempotent based on their input. The system generates a unique identifier for each task execution based on:

- The task name
- A hash of the task input

When you provide a reference ID, it replaces the input hash, allowing you to create different execution contexts for the same task and input combination.

## Determinism vs Reference IDs

You might wonder: if tasks are deterministic (same input → same output) and automatically idempotent within workflows, why do we need reference IDs? This is a great question that highlights the complementary nature of these concepts.

### The Apparent Tension

There seems to be a logical conflict:

- **Determinism**: Same input always produces same output
- **Automatic Idempotency**: Same payload within a workflow only executes once
- **Reference IDs**: Allow forcing re-execution of the same task with same payload

If tasks are truly deterministic and automatically idempotent, why would we ever want to execute the same task twice with the same input?

### Why Reference IDs Are Valuable

#### 1. Intentional Re-execution

Sometimes you want the same task executed multiple times for different reasons:

```typescript
const sendEmail = task({
	name: "send-email",
	handler(input: { email: string; content: string }) {
		return sendEmailToUser(input.email, input.content);
	},
});

// First call: Send welcome email
await sendEmail.start(run, {
	email: "user@example.com",
	content: "Welcome!",
});

// Second call: Send reminder email (same email, different intent)
await sendEmail.with().opt("reference.id", "reminder-email-user-123").start(run, {
	email: "user@example.com",
	content: "Welcome!",
});
```

### Design Philosophy

This design follows the principle of **flexible execution control**:

- **Determinism**: Ensures task logic is predictable, testable, and reliable
- **Automatic Idempotency**: Prevents accidental duplicate executions by default
- **Reference IDs**: Provide explicit control when you need the same operation to happen multiple times

It's similar to having a cache with the ability to bypass it when needed - the function is pure and deterministic, but
you can control when to use cached results vs. fresh execution.

## Benefits of Reference IDs

Reference IDs provide several benefits:

- **External correlation**: Track workflows using your own identifiers (order IDs, user IDs, etc.)
- **Lookup capability**: Find workflow runs by reference ID instead of internal run IDs
- **Duplicate prevention**: Prevent accidental duplicate executions when retrying requests
- **Intentional re-execution**: Execute the same task multiple times by using different reference IDs
