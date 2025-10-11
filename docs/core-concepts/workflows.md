# Workflows

A workflow is a recipe for a business process - it defines the steps needed to complete an operation. Workflows in Aiki are durable, versioned, and can contain complex logic.

## Defining a Workflow

Workflows are created in two steps:

1. **Create the workflow definition** with a name
2. **Add versions** with implementation logic

```typescript
import { workflow } from "@aiki/workflow";

// Step 1: Create workflow definition
const orderWorkflow = workflow({
  name: "order-processing"
});

// Step 2: Create a version
const orderWorkflowV1 = orderWorkflow.v("1.0.0", {
  async exec(input: { orderId: string; amount: number }, run) {
    // Your workflow logic here
    const validation = await validateOrder.start(run, input);
    const payment = await processPayment.start(run, {
      orderId: validation.orderId,
      amount: input.amount
    });

    return { success: true, orderId: validation.orderId };
  }
});
```

## Workflow Properties

### name

A unique identifier for the workflow. Use descriptive names like `"user-onboarding"` or `"order-processing"`.

### version

Specified when calling `.v()`, following semantic versioning (e.g., `"1.0.0"`, `"2.1.0"`). Versioning lets you update workflows without breaking existing executions.

### exec Function

The main orchestration function that:
- Receives input and a run context (`run`)
- Executes tasks in sequence or parallel
- Returns the workflow result

## Workflow Logic

The `exec` function orchestrates your workflow by calling tasks using `.start()`, implementing conditional logic to choose different paths based on data, transforming data between steps, applying application-specific business logic, and handling errors with custom recovery strategies.

```typescript
const orderWorkflowV1 = orderWorkflow.v("1.0.0", {
  async exec(input: { orderData: any }, run) {
    // Validate order
    const validation = await validateOrder.start(run, {
      orderData: input.orderData
    });

    // Business logic: Apply discount
    let finalAmount = validation.amount;
    if (validation.amount > 100) {
      finalAmount = validation.amount * 0.9; // 10% discount
    }

    // Conditional execution
    const payment = await processPayment.start(run, {
      amount: finalAmount
    });

    if (payment.success) {
      await updateInventory.start(run, {
        items: input.orderData.items
      });
    } else {
      await sendFailureNotification.start(run, {
        reason: payment.error
      });
    }

    return { success: payment.success };
  }
});
```

## Workflow Versioning

Versioning allows safe updates to workflows without breaking existing runs.

```typescript
const userOnboardingWorkflow = workflow({
  name: "user-onboarding"
});

// Version 1.0.0: Simple onboarding
const userOnboardingV1 = userOnboardingWorkflow.v("1.0.0", {
  async exec(input: { userId: string }, run) {
    await sendWelcomeEmail.start(run, {
      userId: input.userId
    });
  }
});

// Version 2.0.0: Add profile creation
const userOnboardingV2 = userOnboardingWorkflow.v("2.0.0", {
  async exec(input: { userId: string }, run) {
    await sendWelcomeEmail.start(run, {
      userId: input.userId
    });

    await createUserProfile.start(run, {
      userId: input.userId
    });
  }
});
```

## Starting Workflows

Execute workflows using the version's `.start()` method:

```typescript
const resultHandle = await workflowVersion.start(client, {
  userId: "123",
  email: "user@example.com"
});

// Check status
const status = await resultHandle.getStatus();

// Wait for completion
const result = await resultHandle.waitForCompletion();
```

## Workflow Runs

A workflow run is an instance of a workflow execution. It has:

### States

- `pending` - Queued, not yet started
- `running` - Currently executing
- `completed` - Finished successfully
- `failed` - Encountered an error
- `cancelled` - Cancelled by user/admin

### Result Handle

The result handle provides:

- `id` - Unique run identifier
- `getStatus()` - Check current state
- `waitForCompletion()` - Wait for final result
- `cancel()` - Cancel the run

## Best Practices

1. **Keep workflows focused** - One business process per workflow
2. **Use versions** - Version workflows as requirements change
3. **Deterministic logic** - Workflow logic should be predictable
4. **Document versions** - Comment what changed between versions

## Next Steps

- **[Tasks](./tasks.md)** - Learn about task execution
- **[Workers](./workers.md)** - Understand worker configuration
- **[Task Determinism](../guides/task-determinism.md)** - Write reliable workflows
