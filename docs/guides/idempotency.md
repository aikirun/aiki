# Idempotency

Idempotency keys provide an additional layer of protection against duplicate workflow and task executions. They allow
you to safely retry operations without creating duplicates, even when the same request is sent multiple times.

## What are Idempotency Keys?

An idempotency key is a unique identifier provided by the client when starting a workflow or task. The system stores
this key with the workflow or task execution to prevent duplicate executions when the same key is used again, allowing
safe retries of failed operations.

## Workflow Idempotency

When starting workflows, you can provide an idempotency key to prevent duplicate workflow runs:

```typescript
// Start a workflow with idempotency key
const resultHandle = await orderWorkflowV1
  .withOptions({ idempotencyKey: "order-123-process" })
  .start(client, { orderId: "order-123", items: [...] });

// If this exact same call is made again with the same idempotency key,
// it will return the same workflow run instead of creating a duplicate
const duplicateHandle = await orderWorkflowV1
  .withOptions({ idempotencyKey: "order-123-process" })
  .start(client, { orderId: "order-123", items: [...] });

// duplicateHandle.id === resultHandle.id (same workflow run)
```

## Task Idempotency

Tasks within a workflow are **automatically idempotent** by default. When you run the same task with the same payload
multiple times, it will only execute once and return the cached result:

```typescript
const sendEmail = task({
	id: "send-welcome-email",
	exec(input: { email: string }) {
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

## How Idempotency Works

### Workflow Level

When you provide an `idempotencyKey` when starting a workflow, the system checks if a workflow run with that key already
exists. If it does, it returns the existing workflow run instead of creating a new one.

### Task Level

Tasks within a workflow are automatically idempotent based on their payload. The system generates a unique path for each
task execution that includes:

- The workflow path
- The task name
- A hash of the task payload

When you provide an `idempotencyKey`, it's added to this path, allowing you to create different execution contexts for
the same task and payload combination.

## Determinism vs Idempotency Keys

You might wonder: if tasks are deterministic (same input → same output) and automatically idempotent within workflows,
why do we need idempotency keys? This is a great question that highlights the complementary nature of these concepts.

### The Apparent Tension

There seems to be a logical conflict:

- **Determinism**: Same input always produces same output
- **Automatic Idempotency**: Same payload within a workflow only executes once
- **Idempotency keys**: Allow forcing re-execution of the same task with same payload

If tasks are truly deterministic and automatically idempotent, why would we ever want to execute the same task twice
with the same input?

### Why Idempotency Keys Are Valuable

#### 1. Intentional Re-execution

Sometimes you want the same task executed multiple times for different reasons:

```typescript
const sendEmail = task({
	id: "send-email",
	exec(input: { email: string; content: string }) {
		return sendEmailToUser(input.email, input.content);
	},
});

// First call: Send welcome email
await sendEmail.start(run, {
	email: "user@example.com",
	content: "Welcome!",
});

// Second call: Send reminder email (same email, different intent)
await sendEmail.withOptions({ idempotencyKey: "reminder-email-user-123" }).start(run, {
	email: "user@example.com",
	content: "Welcome!",
});
```

### Design Philosophy

This design follows the principle of **flexible execution control**:

- **Determinism**: Ensures task logic is predictable, testable, and reliable
- **Automatic Idempotency**: Prevents accidental duplicate executions by default
- **Idempotency keys**: Provide explicit control when you need the same operation to happen multiple times

It's similar to having a cache with the ability to bypass it when needed - the function is pure and deterministic, but
you can control when to use cached results vs. fresh execution.

## Benefits of Idempotency Keys

Idempotency keys allow the same task with the same payload to execute multiple times when needed, enabling force
re-execution. They let the same operation happen in different execution contexts and support scenarios where you want
the same operation to occur multiple times intentionally. This provides explicit control over when to bypass automatic
idempotency.

## When to Use Idempotency Keys

Use idempotency keys when you need the same operation to happen multiple times, such as sending emails or notifications.
They're valuable for processing the same data for different purposes like auditing, compliance, or retries. Use them
when you want to retry an operation with the same input but track it separately, or when you need fresh execution even
with the same payload to bypass automatic caching.

## Summary

Determinism, automatic idempotency, and idempotency keys work together to provide flexible execution control.
Determinism ensures your task logic is reliable and predictable. Automatic idempotency prevents accidental duplicate
executions by default. Idempotency keys give you explicit control when you need the same operation to happen multiple
times. Together, they provide the foundation for building robust, efficient, and maintainable workflows that can handle
both the need for consistency and the flexibility for intentional re-execution.
