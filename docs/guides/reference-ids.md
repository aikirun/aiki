# Reference IDs

Reference IDs let you assign custom identifiers to workflows and tasks. This enables tracking, correlation with
your systems, and lookup by your own IDs. As a secondary benefit, reference IDs prevent duplicate executions when
the same reference is reused.

## What are Reference IDs?

A reference ID is a custom identifier you provide when starting a workflow or task. Use cases include:

- **Tracking**: Correlate Aiki workflows with your order IDs, user IDs, or transaction IDs
- **Lookup**: Find a workflow run using your own identifier instead of Aiki's internal run ID
- **Duplicate prevention**: When a reference ID is reused, Aiki can either throw an error or return the existing run

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
// Aiki will throw an error by default (configurable via onConflict)
```

### Conflict Handling

By default, Aiki throws an error when you try to start a workflow with a reference ID that already exists but with
different input. You can configure this behavior with the `onConflict` option:

```typescript
// Default behavior: throw error on conflict
const handle = await orderWorkflowV1
  .with().opt("reference", { id: "order-123-process", onConflict: "error" })
  .start(client, { orderId: "order-123", items: [...] });

// Alternative: return existing run on conflict
const handle = await orderWorkflowV1
  .with().opt("reference", { id: "order-123-process", onConflict: "return_existing" })
  .start(client, { orderId: "order-123", items: [...] });

// With "return_existing", duplicate calls return the same workflow run
// handle.id will be the same as the original run
```

## Task Idempotency

Tasks within a workflow are **automatically idempotent** by default. When you run the same task with the same payload
multiple times, it will only execute once and return the cached result:

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
```

## How It Works

### Workflow Level

When you provide a reference ID when starting a workflow, the system checks if a workflow run with that ID already
exists. Based on the `onConflict` setting:
- `"error"` (default): Throws an error if a run exists with different input
- `"return_existing"`: Returns the existing workflow run

### Task Level

Tasks within a workflow are automatically idempotent based on their payload. The system generates a unique path for each task execution that includes:

- The workflow path
- The task name
- A hash of the task payload

When you provide a reference ID, it's added to this path, allowing you to create different execution contexts for
the same task and payload combination.

## Determinism vs Reference IDs

You might wonder: if tasks are deterministic (same input → same output) and automatically idempotent within workflows,
why do we need reference IDs? This is a great question that highlights the complementary nature of these concepts.

### The Apparent Tension

There seems to be a logical conflict:

- **Determinism**: Same input always produces same output
- **Automatic Idempotency**: Same payload within a workflow only executes once
- **Reference IDs**: Allow forcing re-execution of the same task with same payload

If tasks are truly deterministic and automatically idempotent, why would we ever want to execute the same task twice
with the same input?

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

## When to Use Reference IDs

Use reference IDs when you want to:

- **Correlate with external systems**: Use your order ID, transaction ID, or user ID as the reference
- **Enable lookup**: Find a workflow later using your own identifier
- **Prevent duplicates**: Safely retry requests without creating duplicate workflows
- **Re-execute intentionally**: Run the same task with different reference IDs for different purposes

## Summary

Reference IDs let you assign custom identifiers to workflows and tasks. This enables correlation with your systems
(order IDs, user IDs, etc.), lookup by your own identifiers, and prevents duplicate executions when the same
reference is reused. Combined with automatic task idempotency and deterministic execution, reference IDs provide the
foundation for building robust workflows that integrate seamlessly with your existing systems.
