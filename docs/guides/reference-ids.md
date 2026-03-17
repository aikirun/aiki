# Reference IDs

Reference IDs let you assign custom identifiers to workflows, events, and schedules. This enables tracking, correlation with your systems, and lookup by your own IDs. As a secondary benefit, reference IDs prevent duplicate executions when the same reference is reused.

## What are Reference IDs?

A reference ID is a custom identifier you provide when starting a workflow, sending an event, or activating a schedule. Use cases include:

- **Tracking**: Correlate Aiki workflows with your order IDs, user IDs, or transaction IDs
- **Lookup**: Find a workflow run using your own identifier instead of Aiki's internal run ID
- **Duplicate prevention**: When a reference ID is reused, Aiki can either throw an error, return the existing run, or silently deduplicate (for events)

Reference IDs are unique per workflow version (workflow name + version ID). The same reference ID can be used across different workflow versions without conflict.

> **Note:** Tasks do not support reference IDs. Tasks are content-addressed by `name + hash(input)` — see [Content-Addressed Memoization](../architecture/cam.md) for how this works.

## Workflow Reference IDs

When starting workflows, you can provide a reference ID:

```typescript
// Start a workflow with a reference ID
const handle = await orderWorkflowV1
  .with().opt("reference.id", "order-123")
  .start(client, { orderId: "order-123", items: [...] });

// You can now look up this workflow using "order-123"
// If you try to start another workflow with the same reference ID,
// Aiki will throw an error by default (configurable via conflictPolicy)
```

### Conflict Handling

By default, Aiki throws an error when you try to start a workflow with a reference ID that already exists but with different input. You can configure this behavior with the `conflictPolicy` option:

```typescript
// Default behavior: throw error on conflict
const handle = await orderWorkflowV1
  .with().opt("reference", { id: "order-123-process", conflictPolicy: "error" })
  .start(client, { orderId: "order-123", items: [...] });

// Alternative: return existing run on conflict
const handle = await orderWorkflowV1
  .with().opt("reference", { id: "order-123-process", conflictPolicy: "return_existing" })
  .start(client, { orderId: "order-123", items: [...] });

// With "return_existing", duplicate calls return the same workflow run
// handle.id will be the same as the original run
```

## Event Reference IDs

When sending events to a workflow, you can provide a reference ID to prevent duplicate event delivery:

```typescript
// Send an event with a reference ID
await handle.events.approved
  .with()
  .opt("reference.id", "approval-123")
  .send({ by: "manager@example.com" });

// If the same event is sent again with the same reference ID,
// it will be silently ignored (no error, no duplicate)
await handle.events.approved
  .with()
  .opt("reference.id", "approval-123")
  .send({ by: "manager@example.com" }); // Ignored - duplicate

// Without options, use send directly
await handle.events.approved.send({ by: "manager@example.com" });
```

Unlike workflows, events use **silent deduplication** - duplicate events are simply ignored rather than throwing an error.

## Schedule Reference IDs

When activating schedules, you can provide a reference ID for explicit identity:

```typescript
const handle = await dailyReport
	.with()
	.opt("reference", {
		id: "tenant-acme-daily-report",
		conflictPolicy: "error",
	})
	.activate(client, reportWorkflowV1, { tenantId: "acme" });
```

Schedule conflict policies differ from workflows:

| Policy | Behavior |
|--------|----------|
| `"upsert"` (default) | Update existing schedule if parameters differ |
| `"error"` | Throw error if parameters differ from existing |

With `"upsert"`, re-activating a schedule with different timing or input updates it. With `"error"`, it throws a `ScheduleConflictError` if the parameters don't match.

See the [Schedules documentation](../core-concepts/schedules.md#reference-ids) for more details.

## How It Works

### Workflow Level

When you provide a reference ID when starting a workflow, the system checks if a workflow run with that ID already exists. Based on the `conflictPolicy` setting:
- `"error"` (default): Throws an error if a run exists with different input
- `"return_existing"`: Returns the existing workflow run

## Benefits of Reference IDs

Reference IDs provide several benefits:

- **External correlation**: Track workflows using your own identifiers (order IDs, user IDs, etc.)
- **Lookup capability**: Find workflow runs by reference ID instead of internal run IDs
- **Duplicate prevention**: Prevent accidental duplicate workflow or event executions when retrying requests
