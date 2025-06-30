# Task Determinism

Tasks in durable workflows should be **deterministic** - given the same input, they should always produce the same output. This is crucial for workflow reliability and correctness.

## What is Determinism?

A deterministic task:
- Always returns the same result for the same input
- Has no side effects that depend on external state
- Doesn't rely on random numbers, timestamps, or external APIs that could change

## Why Determinism Matters

### 1. Best Effort Once Execution
Tasks in durable workflows are executed with **best effort once** semantics, not exactly once. This means:
- Tasks may be executed multiple times due to retries, restarts, or network issues
- The same task might run twice with the same input
- Determinism ensures that duplicate executions produce the same result

```typescript
// ❌ Non-deterministic task - dangerous with duplicate execution
const badTask = task({
  name: "create-user",
  run({ payload }) {
    // This could create duplicate users if executed twice
    const userId = generateRandomId(); // Different each time
    return createUserInDatabase(userId, payload.userData);
  }
});

// ✅ Deterministic task - safe with duplicate execution
const goodTask = task({
  name: "create-user",
  run({ payload }) {
    // Same input always produces same result
    const userId = generateIdFromEmail(payload.email); // Deterministic
    return createUserInDatabase(userId, payload.userData);
  }
});
```

### 2. Idempotent Operations
Since tasks may execute multiple times, they should be idempotent:

```typescript
// ✅ Idempotent task - safe to run multiple times
const sendEmail = task({
  name: "send-welcome-email",
  run({ payload }) {
    const { userId, email } = payload;
    
    // Check if email was already sent
    if (await hasEmailBeenSent(userId, "welcome")) {
      return { sent: false, reason: "already sent" };
    }
    
    // Send email and mark as sent
    await sendEmailToUser(email, welcomeTemplate);
    await markEmailAsSent(userId, "welcome");
    
    return { sent: true };
  }
});

// ✅ Idempotent payment processing
const processPayment = task({
  name: "process-payment",
  run({ payload }) {
    const { paymentId, amount } = payload;
    
    // Check if payment was already processed
    const existingPayment = await getPayment(paymentId);
    if (existingPayment && existingPayment.status === "completed") {
      return existingPayment;
    }
    
    // Process payment
    return processPaymentWithId(paymentId, amount);
  }
});
```

### 3. Reliable Replay
When a workflow fails and restarts, tasks must produce the same results to ensure consistency:

```typescript
// ❌ Non-deterministic task
const badTask = task({
  name: "bad-task",
  run({ payload }) {
    // This will produce different results on each run
    const randomId = Math.random();
    const timestamp = Date.now();
    return { id: randomId, time: timestamp };
  }
});

// ✅ Deterministic task
const goodTask = task({
  name: "good-task",
  run({ payload }) {
    // Same input always produces same output
    const userId = payload.userId;
    const email = `${userId}@example.com`;
    return { email, userId };
  }
});
```

### 4. Predictable State Recovery
If a workflow crashes after completing some tasks, deterministic tasks ensure the workflow can resume correctly:

```typescript
const orderWorkflow = workflow({
  name: "process-order",
  version: "1.0.0",
  async run({ workflowRun }) {
    // If this workflow crashes after validateOrder completes,
    // it will resume here with the same result
    const validation = await validateOrder.run(workflowRun, {
      payload: workflowRun.params.payload
    });
    
    // This will always produce the same result for the same order
    const payment = await processPayment.run(workflowRun, {
      payload: { orderId: validation.orderId, amount: validation.amount }
    });
  }
});
```

### 5. Debugging and Testing
Deterministic tasks make workflows easier to debug and test:

```typescript
// Easy to test - same input, same output
const testTask = task({
  name: "calculate-tax",
  run({ payload }) {
    const { amount, taxRate } = payload;
    return { tax: amount * taxRate, total: amount * (1 + taxRate) };
  }
});

// Test case
const result = await testTask.run(mockWorkflowRun, {
  payload: { amount: 100, taxRate: 0.1 }
});
// result will always be { tax: 10, total: 110 }
```

## Making Tasks Deterministic

### Avoid Non-Deterministic Operations

```typescript
// ❌ Avoid these in tasks:
const badPractices = task({
  name: "bad-practices",
  run({ payload }) {
    // Don't use random numbers
    const random = Math.random();
    
    // Don't use current timestamps
    const now = Date.now();
    
    // Don't use external APIs that might change
    const weather = await fetchWeatherAPI();
    
    // Don't use global state
    const globalCounter = incrementGlobalCounter();
    
    return { random, now, weather, globalCounter };
  }
});

// ✅ Use deterministic alternatives:
const goodPractices = task({
  name: "good-practices",
  run({ payload }) {
    // Use provided IDs or generate from input
    const id = generateIdFromInput(payload);
    
    // Use provided timestamps or calculate from input
    const calculatedTime = payload.createdAt + payload.duration;
    
    // Use provided data or fetch once and store
    const userData = payload.userData;
    
    // Use local state based on input
    const localCounter = payload.sequenceNumber;
    
    return { id, calculatedTime, userData, localCounter };
  }
});
```

### Handle External Dependencies
For tasks that need external data, make them deterministic by:
- Passing external data as input
- Using idempotent operations
- Storing external state in the workflow context

```typescript
// ✅ Good: External data passed as input
const sendEmail = task({
  name: "send-email",
  run({ payload }) {
    // Email content is deterministic based on input
    const { recipient, template, variables } = payload;
    const emailContent = generateEmail(template, variables);
    
    // Send email (idempotent operation)
    return sendEmailToRecipient(recipient, emailContent);
  }
});

// ✅ Good: Store external state in workflow
const processPayment = task({
  name: "process-payment",
  run({ payload, workflowRun }) {
    // Use workflow state to ensure determinism
    const paymentId = workflowRun.params.paymentId;
    const amount = workflowRun.params.amount;
    
    // Process payment with deterministic parameters
    return processPaymentWithId(paymentId, amount);
  }
});
```

## Common Anti-Patterns

### 1. Using Random Numbers
```typescript
// ❌ Bad: Random numbers
const badTask = task({
  name: "generate-id",
  run({ payload }) {
    return { id: Math.random().toString(36) };
  }
});

// ✅ Good: Deterministic ID generation
const goodTask = task({
  name: "generate-id",
  run({ payload }) {
    const { userId, timestamp } = payload;
    return { id: `${userId}-${timestamp}` };
  }
});
```

### 2. Using Current Time
```typescript
// ❌ Bad: Current timestamp
const badTask = task({
  name: "create-record",
  run({ payload }) {
    return createRecord({ ...payload, createdAt: Date.now() });
  }
});

// ✅ Good: Use provided timestamp
const goodTask = task({
  name: "create-record",
  run({ payload }) {
    return createRecord({ ...payload, createdAt: payload.createdAt });
  }
});
```

### 3. External API Calls
```typescript
// ❌ Bad: External API that might change
const badTask = task({
  name: "get-exchange-rate",
  run({ payload }) {
    return fetchExchangeRate(payload.currency);
  }
});

// ✅ Good: Pass rate as input or use idempotent lookup
const goodTask = task({
  name: "get-exchange-rate",
  run({ payload }) {
    const { currency, rate } = payload;
    return { currency, rate };
  }
});
```

### 4. Global State
```typescript
// ❌ Bad: Global counter
let globalCounter = 0;
const badTask = task({
  name: "increment-counter",
  run({ payload }) {
    globalCounter++;
    return { counter: globalCounter };
  }
});

// ✅ Good: Pass counter as input
const goodTask = task({
  name: "increment-counter",
  run({ payload }) {
    return { counter: payload.currentCounter + 1 };
  }
});
```

## Testing Deterministic Tasks

### Unit Testing
```typescript
describe("calculateTax task", () => {
  it("should be deterministic", async () => {
    const payload = { amount: 100, taxRate: 0.1 };
    
    // Run the same task multiple times
    const result1 = await calculateTax.run(mockWorkflowRun, { payload });
    const result2 = await calculateTax.run(mockWorkflowRun, { payload });
    const result3 = await calculateTax.run(mockWorkflowRun, { payload });
    
    // All results should be identical
    expect(result1).toEqual(result2);
    expect(result2).toEqual(result3);
    expect(result1).toEqual({ tax: 10, total: 110 });
  });
});
```

### Integration Testing
```typescript
describe("order processing workflow", () => {
  it("should produce same result on replay", async () => {
    const orderData = { orderId: "123", items: [...] };
    
    // Run workflow
    const result1 = await orderWorkflow.enqueue(client, { payload: orderData });
    const finalResult1 = await result1.waitForCompletion();
    
    // Simulate replay by running again with same input
    const result2 = await orderWorkflow.enqueue(client, { payload: orderData });
    const finalResult2 = await result2.waitForCompletion();
    
    // Results should be identical
    expect(finalResult1).toEqual(finalResult2);
  });
});
```

## Benefits of Deterministic Tasks

1. **Reliability**: Workflows can be safely retried and resumed
2. **Consistency**: Same input always produces same output
3. **Debuggability**: Easy to reproduce and debug issues
4. **Testability**: Simple to write unit tests
5. **Predictability**: Workflow behavior is predictable and trustworthy
6. **Duplicate Safety**: Tasks can be executed multiple times without side effects

## Summary

By following these principles, your workflows become more reliable, easier to maintain, and more trustworthy in production environments where network issues, restarts, and retries are inevitable.

**Key Takeaways:**
- Always make tasks deterministic
- Use idempotent operations for external side effects
- Pass external data as input rather than fetching it
- Test that tasks produce the same result for the same input
- Avoid random numbers, timestamps, and global state in tasks 