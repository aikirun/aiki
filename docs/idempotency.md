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
  run({ payload, workflowRun }) {
    const { userId, email } = payload;
    
    // Use workflow run ID + task name as idempotency key
    const idempotencyKey = `${workflowRun.id}-send-welcome-email`;
    
    // Check if this exact task execution already completed
    const existingResult = await getTaskResult(idempotencyKey);
    if (existingResult) {
      return existingResult;
    }
    
    // Send email
    const result = await sendEmailToUser(email, welcomeTemplate);
    
    // Store result with idempotency key
    await storeTaskResult(idempotencyKey, result);
    
    return result;
  }
});
```

## Generating Idempotency Keys

### 1. Business-Based Keys
Use business identifiers that are naturally unique:

```typescript
// Order processing
const orderKey = `order-${orderId}-process`;

// User registration
const userKey = `user-${email}-register`;

// Payment processing
const paymentKey = `payment-${paymentId}-process`;
```

### 2. Composite Keys
Combine multiple identifiers for uniqueness:

```typescript
// Workflow + operation + timestamp
const key = `${workflowName}-${operation}-${timestamp}`;

// User + action + context
const key = `${userId}-${action}-${context}`;
```

### 3. Hash-Based Keys
Generate keys from payload content:

```typescript
import { createHash } from "crypto";

const generateIdempotencyKey = (payload: any, operation: string) => {
  const content = JSON.stringify(payload) + operation;
  return createHash("sha256").update(content).digest("hex");
};

const key = generateIdempotencyKey(orderData, "process-order");
```

## Best Practices

### 1. Make Keys Unique and Deterministic
```typescript
// ✅ Good: Deterministic key generation
const createOrderKey = (orderId: string) => `order-${orderId}-process`;

// ❌ Bad: Non-deterministic key generation
const createOrderKey = () => `order-${Date.now()}-${Math.random()}`;
```

### 2. Include Context in Keys
```typescript
// ✅ Good: Include relevant context
const key = `user-${userId}-email-${emailType}-${timestamp}`;

// ❌ Bad: Too generic
const key = `send-email`;
```

### 3. Handle Key Collisions
```typescript
const processPayment = task({
  name: "process-payment",
  run({ payload, workflowRun }) {
    const { paymentId, amount } = payload;
    const key = `payment-${paymentId}`;
    
    // Check for existing execution
    const existing = await getPaymentExecution(key);
    if (existing) {
      // Return existing result if it was successful
      if (existing.status === "completed") {
        return existing.result;
      }
      // If it failed, we can retry
      if (existing.status === "failed") {
        // Continue with new execution
      }
    }
    
    // Process payment and store result
    const result = await processPaymentWithId(paymentId, amount);
    await storePaymentExecution(key, { status: "completed", result });
    
    return result;
  }
});
```

### 4. Set Appropriate Expiration
```typescript
// Store idempotency keys with expiration
await storeIdempotencyKey(key, result, {
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
});
```

## Idempotency Key Storage

You can implement idempotency key storage using various backends:

### Redis Implementation
```typescript
class RedisIdempotencyStore {
  async get(key: string) {
    return await redis.get(`idempotency:${key}`);
  }
  
  async set(key: string, value: any, ttl: number) {
    await redis.setex(`idempotency:${key}`, ttl, JSON.stringify(value));
  }
}
```

### Database Implementation
```typescript
class DatabaseIdempotencyStore {
  async get(key: string) {
    const result = await db.query(
      "SELECT result FROM idempotency_keys WHERE key = ? AND expires_at > NOW()",
      [key]
    );
    return result[0]?.result;
  }
  
  async set(key: string, value: any, expiresAt: Date) {
    await db.query(
      "INSERT INTO idempotency_keys (key, result, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE result = VALUES(result)",
      [key, JSON.stringify(value), expiresAt]
    );
  }
}
```

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

#### 4. Separation of Concerns
The two concepts serve different purposes:

```typescript
const calculateTax = task({
  name: "calculate-tax",
  run({ payload }) {
    // Deterministic: Same input always produces same output
    return { tax: payload.amount * 0.1 };
  }
});

// Both calls would produce the same result, but:
// - First call: Actually executes the calculation
// - Second call: Returns cached result (performance optimization)
await calculateTax.run(workflowRun, { 
  payload: { amount: 100 }, 
  idempotencyKey: "tax-calculation-100" 
});
await calculateTax.run(workflowRun, { 
  payload: { amount: 100 }, 
  idempotencyKey: "tax-calculation-100" 
});
```

### Design Philosophy

This design follows the principle of **separation of concerns**:

- **Determinism**: Ensures task logic is predictable, testable, and reliable
- **Idempotency keys**: Control execution behavior and optimize performance

It's similar to memoization in functional programming - the function is pure and deterministic, but we cache results for performance.

### Best Practices

#### When to Use the Same Idempotency Key
- Identical task calls where you want to avoid duplicate work
- Expensive operations that produce the same result
- Operations with external side effects you want to prevent

#### When to Use Different Idempotency Keys
- Same task called for different purposes/intents
- When you want to force re-execution even with same input
- Testing or debugging scenarios

#### When to Skip Idempotency Keys
- Simple, fast tasks where overhead isn't worth it
- Tasks that should always execute (like logging)
- When you want to ensure fresh execution every time

## Benefits of Idempotency Keys

1. **Prevent Duplicates**: Ensure operations are only executed once
2. **Safe Retries**: Allow clients to retry failed requests without side effects
3. **Consistency**: Maintain data consistency even with network issues
4. **Audit Trail**: Track and debug duplicate attempts
5. **Performance**: Avoid unnecessary duplicate work

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

By implementing idempotency keys, you can build more robust workflows that handle the realities of distributed systems while maintaining data consistency and preventing duplicate operations. 