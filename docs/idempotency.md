# Idempotency

Idempotency keys provide an additional layer of protection against duplicate workflow and task executions. They allow you to safely retry operations without creating duplicates, even when the same request is sent multiple times.

## What are Idempotency Keys?

An idempotency key is a unique identifier that:
- Is provided by the client when enqueueing a workflow or task
- Is stored with the workflow/task execution
- Prevents duplicate executions when the same key is used
- Allows safe retries of failed operations

## Workflow Idempotency

When enqueueing workflows, you can provide an idempotency key to prevent duplicate workflow runs:

```typescript
// Enqueue a workflow with idempotency key
const resultHandle = await orderWorkflow.enqueue(client, {
  payload: { orderId: "order-123", items: [...] },
  idempotencyKey: "order-123-process" // Unique key for this order
});

// If this exact same call is made again with the same idempotency key,
// it will return the same workflow run instead of creating a duplicate
const duplicateHandle = await orderWorkflow.enqueue(client, {
  payload: { orderId: "order-123", items: [...] },
  idempotencyKey: "order-123-process" // Same key
});

// duplicateHandle.id === resultHandle.id (same workflow run)
```

## Task Idempotency

Tasks can also use idempotency keys to ensure they're only executed once:

```typescript
const sendEmail = task({
  name: "send-welcome-email",
  run({ payload }) {
    return sendEmailToUser(payload.email, welcomeTemplate);
  }
});

// Use idempotency key when running the task
await sendEmail.run(workflowRun, {
  payload: { email: "user@example.com" },
  idempotencyKey: "welcome-email-user-123"
});

// If called again with the same idempotency key, the task won't execute again
await sendEmail.run(workflowRun, {
  payload: { email: "user@example.com" },
  idempotencyKey: "welcome-email-user-123"
});
```

## How Idempotency Works

### Workflow Level
When you provide an `idempotencyKey` when enqueueing a workflow, the system checks if a workflow run with that key already exists. If it does, it returns the existing workflow run instead of creating a new one.

### Task Level
When you provide an `idempotencyKey` when running a task, the system generates a unique path for the task that includes:
- The workflow path
- The task name
- A hash of the task payload
- The idempotency key (if provided)

This ensures that tasks with the same idempotency key and payload are treated as the same execution.

## Determinism vs Idempotency Keys

You might wonder: if tasks are deterministic (same input → same output), why do we need idempotency keys? This is a great question that highlights the complementary nature of these two concepts.

### The Apparent Tension

There seems to be a logical conflict:
- **Determinism**: Same input always produces same output
- **Idempotency keys**: Same key skips execution, returns cached result

If tasks are truly deterministic, calling the same task twice with the same input should produce the same result anyway, making idempotency keys seem redundant.

### Why Both Concepts Are Valuable

#### 1. Performance Optimization
Even deterministic tasks can be expensive to execute:

```typescript
const expensiveTask = task({
  name: "fetch-user-data",
  run({ payload }) {
    // Deterministic but expensive - database queries, API calls
    return fetchUserFromDatabase(payload.userId);
  }
});

// Without idempotency: Executes twice, makes two DB calls
await expensiveTask.run(workflowRun, { payload: { userId: "123" } });
await expensiveTask.run(workflowRun, { payload: { userId: "123" } });

// With idempotency: Executes once, caches result
await expensiveTask.run(workflowRun, { 
  payload: { userId: "123" }, 
  idempotencyKey: "user-123" 
});
await expensiveTask.run(workflowRun, { 
  payload: { userId: "123" }, 
  idempotencyKey: "user-123" 
});
```

#### 2. External Side Effects
Deterministic tasks might still have external side effects:

```typescript
const sendEmail = task({
  name: "send-email",
  run({ payload }) {
    // Deterministic: Same input always produces same result
    // But we don't want to send the email twice!
    return sendEmailToUser(payload.email, payload.content);
  }
});

// First call: Actually sends email
await sendEmail.run(workflowRun, { 
  payload: { email: "user@example.com", content: "Welcome!" },
  idempotencyKey: "welcome-email-user-123"
});

// Second call: Returns cached result, doesn't send duplicate email
await sendEmail.run(workflowRun, { 
  payload: { email: "user@example.com", content: "Welcome!" },
  idempotencyKey: "welcome-email-user-123"
});
```

#### 3. Different Intent with Same Input
Sometimes you want the same task executed multiple times for different reasons:

```typescript
// First call: Send welcome email
await sendEmail.run(workflowRun, { 
  payload: { email: "user@example.com", content: "Welcome!" },
  idempotencyKey: "welcome-email-user-123"
});

// Second call: Send reminder email (same email, different intent)
await sendEmail.run(workflowRun, { 
  payload: { email: "user@example.com", content: "Welcome!" },
  idempotencyKey: "reminder-email-user-123" // Different key = different execution
});
```

### Design Philosophy

This design follows the principle of **separation of concerns**:

- **Determinism**: Ensures task logic is predictable, testable, and reliable
- **Idempotency keys**: Control execution behavior and optimize performance

It's similar to memoization in functional programming - the function is pure and deterministic, but we cache results for performance.

## Benefits of Idempotency Keys

1. **Prevent Duplicates**: Ensure operations are only executed once
2. **Safe Retries**: Allow clients to retry failed requests without side effects
3. **Consistency**: Maintain data consistency even with network issues
4. **Performance**: Avoid unnecessary duplicate work

## When to Use Idempotency Keys

- **Critical Operations**: Payments, user creation, order processing
- **External API Calls**: Email sending, webhook notifications
- **Resource Creation**: Database records, file uploads
- **State Changes**: Status updates, configuration changes

## Summary

Determinism and idempotency keys are complementary concepts:
- **Determinism** ensures your task logic is reliable and predictable
- **Idempotency keys** give you control over execution behavior and performance

Together, they provide the foundation for building robust, efficient, and maintainable workflows that can handle the complexities of distributed systems. 