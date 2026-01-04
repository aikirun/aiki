# Task Determinism

When I first started working with durable execution, I was puzzled by the emphasis on task determinism. Why does it
matter if a task produces the same result every time? After all, isn't the whole point of workflows to handle dynamic,
real-world scenarios?

It took me a while to understand that determinism isn't about making tasks boring or predictable - it's about making
them **reliable**. Let me walk you through why this matters and how to implement it effectively.

## What is Determinism?

A deterministic task is one that always returns the same result for the same input. Think of it like a mathematical
function: if you put in 2 + 2, you always get 4, regardless of when you do the calculation or how many times you repeat
it.

Here's a simple example:

```typescript
// ✅ Deterministic task
const calculateTax = task({
	id: "calculate-tax",
	handler(input: { amount: number; taxRate: number }) {
		const { amount, taxRate } = input;
		return { tax: amount * taxRate, total: amount * (1 + taxRate) };
	},
});

// This will always return { tax: 10, total: 110 } for the same input
const result = await calculateTax.start(run, {
	amount: 100,
	taxRate: 0.1,
});
```

## Why Determinism Matters

### 1. Best Effort Once Execution

This is the most important reason. Tasks in durable executions are executed with **best effort once** semantics, not
exactly once. This means:

- Tasks may be executed multiple times due to retries, restarts, or network issues
- The same task might run twice with the same input
- Determinism ensures that duplicate executions produce the same result

Let me illustrate this with a cautionary tale:

```typescript
// ❌ Non-deterministic task - dangerous with duplicate execution
const badTask = task({
	id: "create-user",
	handler(input: { email: string; userData: any }) {
		// This could create duplicate users if executed twice
		const userId = generateRandomId(); // Different each time!
		return createUserInDatabase(userId, input.userData);
	},
});

// ✅ Deterministic task - safe with duplicate execution
const goodTask = task({
	id: "create-user",
	handler(input: { email: string; userData: any }) {
		// Same input always produces same result
		const userId = generateIdFromEmail(input.email); // Deterministic!
		return createUserInDatabase(userId, input.userData);
	},
});
```

If the first task runs twice (which can happen), you'll end up with two users with different IDs. If the second task
runs twice, you'll get the same user ID both times, and the second execution will either fail gracefully or update the
existing user.

### 2. Idempotent Operations

Since tasks may execute multiple times, they should be idempotent. This means running the same operation multiple times
has the same effect as running it once.

```typescript
// ✅ Idempotent task - safe to run multiple times
const sendEmail = task({
	id: "send-welcome-email",
	handler(input: { userId: string; email: string }) {
		const { userId, email } = input;

		// Check if email was already sent
		if (await hasEmailBeenSent(userId, "welcome")) {
			return { sent: false, reason: "already sent" };
		}

		// Send email and mark as sent
		await sendEmailToUser(email, welcomeTemplate);
		await markEmailAsSent(userId, "welcome");

		return { sent: true };
	},
});

// ✅ Idempotent payment processing
const processPayment = task({
	id: "process-payment",
	handler(input: { paymentId: string; amount: number }) {
		const { paymentId, amount } = input;

		// Check if payment was already processed
		const existingPayment = await getPayment(paymentId);
		if (existingPayment && existingPayment.status === "completed") {
			return existingPayment;
		}

		// Process payment
		return processPaymentWithId(paymentId, amount);
	},
});
```

### 3. Reliable Replay

When a workflow fails and restarts, tasks must produce the same results to ensure consistency. This is critical for
debugging and recovery.

```typescript
// ❌ Non-deterministic task
const badTask = task({
	id: "bad-task",
	handler(input: {}) {
		// This will produce different results on each run
		const randomId = Math.random();
		const timestamp = Date.now();
		return { id: randomId, time: timestamp };
	},
});

// ✅ Deterministic task
const goodTask = task({
	id: "good-task",
	handler(input: { userId: string }) {
		// Same input always produces same output
		const userId = input.userId;
		const email = `${userId}@example.com`;
		return { email, userId };
	},
});
```

### 4. Predictable State Recovery

If a workflow crashes after completing some tasks, deterministic tasks ensure the workflow can resume correctly:

```typescript
const orderWorkflow = workflow({
	id: "process-order",
});

const orderWorkflowV1 = orderWorkflow.v("1.0.0", {
	async handler(run, input: { orderId: string; amount: number }) {
		// If this workflow crashes after validateOrder completes,
		// it will resume here with the same result
		const validation = await validateOrder.start(run, input);

		// This will always produce the same result for the same order
		const payment = await processPayment.start(run, {
			orderId: validation.orderId,
			amount: validation.amount,
		});
	},
});
```

### 5. Debugging and Testing

Deterministic tasks make workflows easier to debug and test:

```typescript
// Easy to test - same input, same output
const testTask = task({
	id: "calculate-tax",
	handler(input: { amount: number; taxRate: number }) {
		const { amount, taxRate } = input;
		return { tax: amount * taxRate, total: amount * (1 + taxRate) };
	},
});

// Test case
const result = await testTask.start(mockWorkflowRun, {
	amount: 100,
	taxRate: 0.1,
});
// result will always be { tax: 10, total: 110 }
```

## Making Tasks Deterministic

### Avoid Non-Deterministic Operations

Here are the common pitfalls to avoid:

```typescript
// ❌ Avoid these in tasks:
const badPractices = task({
	id: "bad-practices",
	handler(input: {}) {
		// Don't use random numbers
		const random = Math.random();

		// Don't use current timestamps
		const now = Date.now();

		// Don't use external APIs that might change
		const weather = await fetchWeatherAPI();

		// Don't use global state
		const globalCounter = incrementGlobalCounter();

		return { random, now, weather, globalCounter };
	},
});

// ✅ Use deterministic alternatives:
const goodPractices = task({
	id: "good-practices",
	handler(input: { createdAt: number; duration: number; userData: any; sequenceNumber: number }) {
		// Use provided IDs or generate from input
		const id = generateIdFromInput(input);

		// Use provided timestamps or calculate from input
		const calculatedTime = input.createdAt + input.duration;

		// Use provided data or fetch once and store
		const userData = input.userData;

		// Use local state based on input
		const localCounter = input.sequenceNumber;

		return { id, calculatedTime, userData, localCounter };
	},
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
	id: "send-email",
	handler(input: { recipient: string; template: string; variables: Record<string, any> }) {
		// Email content is deterministic based on input
		const { recipient, template, variables } = input;
		const emailContent = generateEmail(template, variables);

		// Send email (idempotent operation)
		return sendEmailToRecipient(recipient, emailContent);
	},
});

// ✅ Good: Store external state in workflow
const processPayment = task({
	id: "process-payment",
	handler(input: { paymentId: string; amount: number }) {
		// Use input parameters to ensure determinism
		const { paymentId, amount } = input;

		// Process payment with deterministic parameters
		return processPaymentWithId(paymentId, amount);
	},
});
```

## Common Anti-Patterns

### 1. Using Random Numbers

```typescript
// ❌ Bad: Random numbers
const badTask = task({
	id: "generate-id",
	handler(input: {}) {
		return { id: Math.random().toString(36) };
	},
});

// ✅ Good: Deterministic ID generation
const goodTask = task({
	id: "generate-id",
	handler(input: { userId: string; timestamp: number }) {
		const { userId, timestamp } = input;
		return { id: `${userId}-${timestamp}` };
	},
});
```

### 2. Using Current Time

```typescript
// ❌ Bad: Current timestamp
const badTask = task({
	id: "create-record",
	handler(input: { data: any }) {
		return createRecord({ ...input.data, createdAt: Date.now() });
	},
});

// ✅ Good: Use provided timestamp
const goodTask = task({
	id: "create-record",
	handler(input: { data: any; createdAt: number }) {
		return createRecord({ ...input.data, createdAt: input.createdAt });
	},
});
```

### 3. External API Calls

```typescript
// ❌ Bad: External API that might change
const badTask = task({
	id: "get-exchange-rate",
	handler(input: { currency: string }) {
		return fetchExchangeRate(input.currency);
	},
});

// ✅ Good: Pass rate as input or use idempotent lookup
const goodTask = task({
	id: "get-exchange-rate",
	handler(input: { currency: string; rate: number }) {
		const { currency, rate } = input;
		return { currency, rate };
	},
});
```

### 4. Global State

```typescript
// ❌ Bad: Global counter
let globalCounter = 0;
const badTask = task({
	id: "increment-counter",
	handler(input: {}) {
		globalCounter++;
		return { counter: globalCounter };
	},
});

// ✅ Good: Pass counter as input
const goodTask = task({
	id: "increment-counter",
	handler(input: { currentCounter: number }) {
		return { counter: input.currentCounter + 1 };
	},
});
```

## Testing Deterministic Tasks

### Unit Testing

```typescript
describe("calculateTax task", () => {
	it("should be deterministic", async () => {
		const input = { amount: 100, taxRate: 0.1 };

		// Run the same task multiple times
		const result1 = await calculateTax.start(mockWorkflowRun, input);
		const result2 = await calculateTax.start(mockWorkflowRun, input);
		const result3 = await calculateTax.start(mockWorkflowRun, input);

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
		const orderData = { orderId: "123", items: [{ id: "item-1", quantity: 2 }] };

		// Run workflow
		const result1 = await orderWorkflowV1.start(client, orderData);
		const finalResult1 = await result1.waitForCompletion();

		// Simulate replay by running again with same input
		const result2 = await orderWorkflowV1.start(client, orderData);
		const finalResult2 = await result2.waitForCompletion();

		// Results should be identical
		expect(finalResult1).toEqual(finalResult2);
	});
});
```

## Benefits of Deterministic Tasks

Deterministic tasks enable workflows to be safely retried and resumed without unexpected behavior. They guarantee
consistency by ensuring the same input always produces the same output. Debugging becomes easier because issues are
reproducible. Testing simplifies since you can write straightforward unit tests with predictable outcomes. Workflow
behavior becomes trustworthy and predictable. Finally, tasks can safely execute multiple times without unwanted side
effects.

## Summary

By following these principles, your workflows become more reliable, easier to maintain, and more trustworthy in
production environments where network issues, restarts, and retries are inevitable.

**Key Takeaways:**

- Always make tasks deterministic
- Use idempotent operations for external side effects
- Pass external data as input rather than fetching it
- Test that tasks produce the same result for the same input
- Avoid random numbers, timestamps, and global state in tasks

Remember, determinism isn't about making your tasks boring - it's about making them bulletproof. When you can trust that
your tasks will behave consistently, you can build workflows that are truly reliable and maintainable.
