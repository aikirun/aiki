# Refactoring Workflows

This guide is about refactoring workflow versions while it has in-flight runs. If no runs exist, you can change your code freely - these concerns only arise when running workflows replay with new code.

> As a caveat; when in doubt, instead of refacotoring, upgrade the workflow by creating a new version via `workflow.v()`.

Aiki's content-addressable design allows you to safely refactor running workflows in ways that would cause determinism errors in other durable execution platforms. This guide explains what changes are safe and what to watch out for.

## How Aiki Differs

Traditional durable execution systems like Temporal require strict determinism; any change to workflow code can cause replay errors. Aiki takes a different approach:

- **Tasks are identified by name + input hash** (content-addressable)
- **Already-executed tasks return cached results** regardless of code order
- **New tasks execute fresh**
- **Changed inputs trigger re-execution**

This gives you flexibility to evolve your workflows without breaking running executions.

## Safe Refactoring Operations

### Reordering Tasks

You can change the order of tasks in your workflow code. Content addressing means each task is identified by its name and input, not its position:

```typescript
// Original workflow
async handler(run, input) {
	const user = await fetchUser.start(run, { userId: input.userId });
	const order = await createOrder.start(run, { userId: input.userId });
	await sendConfirmation.start(run, { email: user.email, orderId: order.id });
}

// Refactored - reordered tasks
async handler(run, input) {
	const order = await createOrder.start(run, { userId: input.userId }); // Returns cached
	const user = await fetchUser.start(run, { userId: input.userId });    // Returns cached
	await sendConfirmation.start(run, { email: user.email, orderId: order.id });
}
```

On replay, both `fetchUser` and `createOrder` return their cached results regardless of the new order.

### Adding New Tasks

You can add new tasks to a workflow. Existing tasks return cached results, and new tasks execute fresh:

```typescript
// Original workflow ran and completed tasks A and B
async handler(run, input) {
	await taskA.start(run, input);
	await taskB.start(run, input);
}

// Refactored with new task C
async handler(run, input) {
	await taskA.start(run, input);  // Returns cached result
	await taskC.start(run, input);  // Executes fresh
	await taskB.start(run, input);  // Returns cached result
}
```

### Removing Tasks

You can remove tasks from your workflow. Their cached results remain in storage but are simply not used:

```typescript
// Original workflow
async handler(run, input) {
	await validateInput.start(run, input);
	await processData.start(run, input);
	await sendNotification.start(run, input);
}

// Refactored - removed validateInput
async handler(run, input) {
	await processData.start(run, input);    // Returns cached result
	await sendNotification.start(run, input); // Returns cached result
}
```

### Reordering Event Waits

Each event type has its own internal queue, so you can reorder event waits:

```typescript
// Original workflow
async handler(run, input) {
	const approval = await run.events.approved.wait();
	const payment = await run.events.paymentReceived.wait();
	// Process order...
}

// Refactored - reordered waits
async handler(run, input) {
	const payment = await run.events.paymentReceived.wait(); // Reads from payment queue
	const approval = await run.events.approved.wait();       // Reads from approval queue
	// Process order...
}
```

### Adding Event Waits

You can add new event waits to a workflow. They wait for new events to arrive:

```typescript
// Original workflow
async handler(run, input) {
	await processOrder.start(run, input);
}

// Refactored with new event wait
async handler(run, input) {
	const approval = await run.events.managerApproval.wait(); // Waits for new event
	await processOrder.start(run, input);
}
```

### Reordering Different-Named Sleeps

Sleeps with different names can be reordered. Each sleep name has its own queue, so the order doesn't matter:

```typescript
// Original workflow - total sleep: 1 hour 5 minutes
async handler(run, input) {
	await run.sleep("initial-delay", { minutes: 5 });
	await run.sleep("cooldown-period", { hours: 1 });
	await processOrder.start(run, input);
}

// Refactored - reordered sleeps (still 1 hour 5 minutes total)
async handler(run, input) {
	await run.sleep("cooldown-period", { hours: 1 }); // Reads from cooldown-period queue
	await run.sleep("initial-delay", { minutes: 5 }); // Reads from initial-delay queue
	await processOrder.start(run, input);
}
```

### Changing Sleep Durations

When you change a sleep duration, Aiki calculates the delta:

```typescript
// Original: workflow was sleeping for 1 hour
async handler(run, input) {
	await processOrder.start(run, input);
	await run.sleep("wait-for-fulfillment", { hours: 1 });
	await sendShippingUpdate.start(run, input);
}

// Code refactored while sleeping. When workflow wakes up after 1 hour,
// it sees the new duration and sleeps 30 more minutes.
async handler(run, input) {
	await processOrder.start(run, input);  // Returns cached
	await run.sleep("wait-for-fulfillment", { hours: 1, minutes: 30 }); // Sleeps 30 more min
	await sendShippingUpdate.start(run, input);
}

// If refactored to a shorter duration (30 minutes), the sleep is already
// satisfied, so the workflow continues immediately.
async handler(run, input) {
	await processOrder.start(run, input);  // Returns cached
	await run.sleep("wait-for-fulfillment", { minutes: 30 }); // Already satisfied, continues
	await sendShippingUpdate.start(run, input);
}
```

## Operations That Cause Re-execution

### Changing Task Inputs

If you change the input to a task, the hash changes and the task re-executes:

```typescript
// Original
async handler(run, input) {
	await processOrder.start(run, { orderId: input.orderId, discount: 0 });
}

// Changed input - WILL RE-EXECUTE
async handler(run, input) {
	await processOrder.start(run, { orderId: input.orderId, discount: 0.1 });
}
```

**Important:** If the task has side effects (charging a card, sending an email), this could cause issues. The task will run again with the new input.

### Changing Task Names

Renaming a task creates a new task from Aiki's perspective:

```typescript
// Original
const processOrder = task({ name: "process-order", ... });

// Renamed - treated as a completely new task
const processOrder = task({ name: "handle-order", ... });
```

The old cached result under `"process-order"` won't be found, and `"handle-order"` will execute fresh.

## What to Watch Out For

### Tasks with Side Effects

Be cautious when changing inputs to tasks that:
- Charge credit cards
- Send emails or notifications
- Write to external databases
- Call third-party APIs

If the task re-executes, those side effects happen again. Use [idempotency patterns](./determinism.md#task-idempotency) to protect against this.

### Changing Task or Child-Workflow Output Shapes

Cached results preserve the old output shape. If you change what a task or child-worlfow returns, running workflows will still receive the old cached data.

```typescript
// Original: fetchUser returns { email: "..." }
const fetchUser = task({
	name: "fetch-user",
	handler(input: { userId: string }) {
		const user = db.users.find(input.userId);
		return { email: user.email };
	},
});

// Workflow runs, task executes, result cached: { email: "user@example.com" }
```

Later, you refactor the task to return a different shape:

```typescript
// Refactored: now returns { emailAddress: "..." }
const fetchUser = task({
	name: "fetch-user",
	handler(input: { userId: string }) {
		const user = db.users.find(input.userId);
		return { emailAddress: user.email };  // Changed field name
	},
});

// On replay: cached result still has OLD shape { email: "..." }
async handler(run, input) {
	const user = await fetchUser.start(run, { userId: input.userId });
	// user.emailAddress is undefined - cached result has "email" not "emailAddress"
	await sendEmail.start(run, { to: user.emailAddress });
}
```

**Workflows have the same issue** - their outputs are also frozen in cache.

#### Solutions

1. **Make backwards-compatible changes only** - Add new fields instead of renaming or removing existing ones. This is the safest approach.

2. **Create a new workflow version** - If you need to change a task's output shape, create a new workflow version. Each workflow version has its own cache namespace, so existing runs continue with the old shape while new runs use the new shape.

3. **Schema validation** - Define output schemas for your tasks and workflows. Aiki validates cached results against the schema, so if a cached result has the old shape, the workflow fails immediately rather than silently returning mismatched data.

4. **Use discriminated unions for output versioning** - Include a version discriminator in your output type:
   ```typescript
   type UserV1 = { version: 1; email: string };
   type UserV2 = { version: 2; emailAddress: string };
   type UserOutput = UserV1 | UserV2;
   ```
   Your workflow code can then handle both shapes based on the version field.

5. **Wait for running workflows to complete** - Deploy the output shape change only after all in-flight workflows finish. This avoids the mismatch entirely, but isn't always practical for long-running workflows.

> **Future consideration:** Upcasting (transforming old cached data to new shapes at read time) may be added if there's demand for it.

### Conditional Logic Changes

Changing conditional logic can lead to unexpected execution paths:

```typescript
// Original - only premium users get discount
async handler(run, input) {
	if (input.isPremium) {
		await applyDiscount.start(run, input);
	}
	await processOrder.start(run, input);
}

// Changed - now all users get discount
async handler(run, input) {
	await applyDiscount.start(run, input); // Now runs for everyone
	await processOrder.start(run, input);
}
```

### Same-Named Sleeps

Sleeps with the same name share a queue. Reordering, removing, or adding same-named sleeps while a workflow is in flight causes queue mismatch.

**Always use different names for different sleeps:**

```typescript
// DON'T use the same name for different sleeps
async handler(run, input) {
	await run.sleep("delay", { minutes: 5 });
	await run.sleep("delay", { hours: 1 });
}

// DO use different names
async handler(run, input) {
	await run.sleep("initial-delay", { minutes: 5 });
	await run.sleep("cooldown", { hours: 1 });
}
```

With different names, each sleep has its own queue and can be safely reordered, removed, or added.

#### Why This Matters: Reordering

```typescript
// Original workflow
async handler(run, input) {
	await run.sleep("delay", { minutes: 5 });
	await run.sleep("delay", { hours: 1 }); // Workflow is sleeping here
	await processOrder.start(run, input);
}
```

1. First sleep (5 min) completes
2. Workflow is sleeping on second sleep (1 hr)
3. Developer swaps the order:

```typescript
// Refactored while workflow was sleeping
async handler(run, input) {
	await run.sleep("delay", { hours: 1 });
	await run.sleep("delay", { minutes: 5 });
	await processOrder.start(run, input);
}
```

4. After 1 hour, workflow wakes and replays
5. First `"delay"` call asks for 1 hour, reads first recorded sleep (5 min elapsed)
6. Aiki calculates delta: 1hr - 5min = 55 more minutes needed
7. Workflow goes back to sleep for 55 minutes!

#### Why This Matters: Removing

```typescript
// Original workflow
async handler(run, input) {
	await run.sleep("delay", { minutes: 5 });
	await run.sleep("delay", { hours: 1 }); // Workflow is sleeping here
	await processOrder.start(run, input);
}
```

1. First sleep (5 min) completes
2. Workflow is sleeping on second sleep (1 hr)
3. Developer removes the first sleep:

```typescript
// Refactored - removed first sleep
async handler(run, input) {
	await run.sleep("delay", { hours: 1 }); // Reads 5min from queue!
	await processOrder.start(run, input);
}
```

4. After 1 hour, workflow wakes and replays
5. Remaining sleep reads first from queue - gets 5 min result
6. Aiki calculates delta: 1hr - 5min = 55 more minutes needed
7. Workflow goes back to sleep!

### Same-Named Events

Events have the same queue-based behavior as sleeps, but with an important difference: events come from external systems, so the order is inherently unpredictable.

Two different external processes might trigger the same event type simultaneously. Your workflow code should never rely on the order of same-named events:

```typescript
// DON'T rely on order - external systems may send events in any order
async handler(run, input) {
	const first = await run.events.statusUpdate.wait();   // Which update comes first?
	const second = await run.events.statusUpdate.wait();  // Unpredictable!
}

// DO use different event types when order matters
async handler(run, input) {
	const started = await run.events.started.wait();
	const completed = await run.events.completed.wait();
}
```

This is a design principle, not just a refactoring concern. Even without any code changes, external event ordering is non-deterministic.

## Best Practices

1. **Test with replays** - Before deploying refactored workflows, test that replays work as expected

2. **Use idempotency for side effects** - Protect external operations with idempotency keys

3. **Keep task names stable** - Avoid renaming tasks in long-running workflows

4. **Be careful with input changes** - Understand that changed inputs cause re-execution

5. **Prefer determinism** - While Aiki is flexible, deterministic workflows are still easier to reason about

## Summary

Aiki's content-addressable design gives you freedom to refactor workflows without strict determinism requirements. You can reorder tasks, add new ones, remove old ones, reorder event waits, reorder sleeps, and adjust sleep durations. Just be mindful of tasks with side effects and data dependencies between tasks.

When in doubt, create a new workflow version.

## Next Steps

- **[Determinism and Idempotency](./determinism.md)** - Best practices for reliable workflows
- **[Reference IDs](./reference-ids.md)** - Prevent duplicate executions
- **[Retry Strategies](./retry-strategies.md)** - Configure automatic retries
