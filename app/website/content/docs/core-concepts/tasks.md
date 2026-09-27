---
title: Tasks
description: The boundary for side effects and nondeterministic work, recorded once and replayed.
---

Tasks are the boundary for side effects and nondeterministic work in a workflow. A task handler is where network requests, database writes, reading the clock, and generating random values belong.

When your workflow calls a task, the handler runs then and there, on the worker executing the run. Nothing is queued and nothing is handed to another process - a task is an ordinary function call, with its result recorded. [Child workflows](./workflows.md#child-workflows) are what gets dispatched.

Once a task completes, its result is recorded and reused on replay instead of running the handler again. A task can still execute more than once - a worker may fail after the side effect lands but before the result is durably recorded - so task handlers should be idempotent.

## Defining a Task

```typescript
import { task } from "@aikirun/workflow";

const sendEmail = task({
	name: "send-email",
	handler(input: { email: string; message: string }) {
		// Your business logic
		return sendEmailToUser(input.email, input.message);
	},
});
```

## Task Properties

### name

A unique identifier for the task. Use descriptive names like `"send-email"` or `"process-payment"`.

### handler Function

The function that performs the actual work. It receives:

- `input` - Input data for the task

```typescript
const processPayment = task({
	name: "process-payment",
	handler(input: { paymentId: string; amount: number }) {
		console.log(`Processing payment for ${input.paymentId}`);

		return processPaymentWithId(input.paymentId, input.amount);
	},
});
```

## Executing Tasks

Tasks are executed within workflows using `.start()`, which calls the handler and returns its result:

```typescript
const orderWorkflowV1 = orderWorkflow.v("1.0.0", {
	async handler(run, input: { orderData: any }) {
		const validation = await validateOrder.start(run, {
			orderData: input.orderData,
		});

		const payment = await processPayment.start(run, {
			paymentId: validation.paymentId,
			amount: validation.amount,
		});

		return { success: true };
	},
});
```

Starting several tasks with `Promise.all` works, and interleaves them the way any async code interleaves in one process - useful for overlapping I/O, but it does not spread the work across workers. Reach for [child workflows](./workflows.md#child-workflows) when you want that.

## Task Retry

Configure automatic retries for failed tasks using the `retry` property:

```typescript
const processPayment = task({
	name: "process-payment",
	handler(input: { paymentId: string; amount: number }) {
		return paymentService.charge(input.paymentId, input.amount);
	},
	retry: {
		type: "exponential",
		maxAttempts: 3,
		baseDelayMs: 1000,
	},
});
```

For available strategies and best practices, see the **[Retry Strategies Guide](../guides/retry-strategies.md)**.

## Task States

A task moves through these states:

- `running` - Executing now
- `awaiting_retry` - The attempt failed and the task is backing off before the next one; carries the error and the time of the next attempt
- `completed` - Succeeded; its output is recorded and returned on replay
- `failed` - The retry strategy has no attempts left
- `discarded` - An unfinished task the run left behind; it no longer takes part in replay

While a task sits in `awaiting_retry`, its run parks in `awaiting_task_retry` and releases its worker; the server re-queues the run when the task is due. Short backoffs are the exception: a delay within `maxInlineWaitMs` (10ms by default) is waited out in place, so the task stays `running` and the run never parks.

A task's attempts are its own, separate from the run's, so a task backing off does not move the run's attempt count. When the task runs out of attempts it goes `failed`, and that failure becomes the workflow attempt's failure: the run moves to [`awaiting_retry`](./workflows.md#states) if the workflow has attempts left, or to `failed` if it does not, with cause `task` either way.

Only unfinished tasks are ever discarded. Cancelling or stalling a run discards the tasks it left `running` or `awaiting_retry`, since nothing will finish them. Retrying a workflow attempt discards those too, along with any `failed` task, so the new attempt runs them again from their first attempt. A `completed` task is never discarded - its output is kept and replayed, so a retry resumes rather than repeating work that already succeeded.

## Schema Validation

Define schemas to validate task input and output at runtime:

```typescript
import { z } from "zod";

const processPayment = task({
	name: "process-payment",
	schema: {
		input: z.object({
			paymentId: z.string(),
			amount: z.number().positive(),
		}),
		output: z.object({
			transactionId: z.string(),
			status: z.enum(["success", "failed"]),
		}),
	},
	handler(input) {
		return paymentService.charge(input);
	},
});
```

Schemas work with any validation library that implements [Standard Schema](https://standardschema.dev/) (Zod, Valibot, ArkType, etc.).

**Why use output schemas?** The output schema checks what the handler returns, at the moment it returns it, so a task cannot record a result that does not match its declared shape. It runs when the task executes, not when a recorded result is replayed - a result recorded before you changed the shape is replayed as it was written. See [Refactoring Workflows](../guides/refactoring-workflows.md#changing-task-or-child-workflow-output-shapes).

## Task Input and Output

A task receives its input directly and returns its output. Both must be plain JSON data; see [Inputs and Outputs](./workflows.md#inputs-and-outputs).

```typescript
const exampleTask = task({
	name: "example",
	handler(input: { data: string }) {
		// input: Input data for this task
		console.log("Task input:", input);

		return { processed: true };
	},
});
```

## Task Best Practices

1. **Keep tasks focused** - One responsibility per task
2. **Make tasks idempotent** - A task may re-execute after a crash; running it twice with the same input should be safe
3. **Put side effects in tasks** - API calls, database writes, and anything non-deterministic belong in tasks, keeping the workflow handler deterministic
4. **Use meaningful names** - Clear, descriptive task names

## Next Steps

- **[Workflows](./workflows.md)** - Learn about workflow orchestration
- **[Determinism](../guides/determinism.md)** - Workflow determinism and task idempotency
- **[Reference IDs](../guides/reference-ids.md)** - Custom identifiers for workflows and events
- **[Dependency Injection](../guides/dependency-injection.md)** - Inject dependencies into tasks
