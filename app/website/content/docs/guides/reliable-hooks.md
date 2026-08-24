---
title: Reliable Hooks
---

To trigger a reliable hook after a workflow completes or fails or is cancelled, wrap both the main workflow and the hook in a parent workflow.

## The Pattern

```typescript
const orderWithHooks = workflow({ name: "order-with-hooks" });

const orderWithHooksV1 = orderWithHooks.v("1.0.0", {
	async handler(run, input: { orderId: string }) {
		// Run main workflow and wait for it to finish
		const handle = await orderWorkflowV1.startAsChild(run, input);
		const { state } = await handle.wait();

		if (state.status !== "completed") {
			throw new Error(`Order workflow ended ${state.status}`);
		}

		// Run hook
		await notificationWorkflowV1.startAsChild(run, {
			orderId: input.orderId,
		});

		return state.output;
	},
});
```

This way you're guaranteed that the hook will be called on workflow completion, even if server crashes and restarts.

## Next Steps

- **[Workflows](../core-concepts/workflows.md)** - Child workflows
