# Schedules

A schedule automatically triggers workflows at defined times or intervals. Use schedules for recurring jobs like daily reports, hourly syncs, or cron-based maintenance tasks.

## Creating a Schedule

```typescript
import { client } from "@aikirun/client";
import { schedule } from "@aikirun/workflow";
import { dailyReportWorkflowV1 } from "./workflows";

const aikiClient = client({
	url: "http://localhost:9850",
	redis: { host: "localhost", port: 6379 },
});

const dailyReport = schedule({
	type: "cron",
	expression: "0 9 * * *", // Every day at 9 AM UTC
});

const handle = await dailyReport.activate(
	aikiClient,
	dailyReportWorkflowV1,
	{ reportType: "sales" } // Workflow input
);
```

The `schedule()` function defines a timing configuration. Call `activate()` to bind it to a workflow - the workflow will then trigger automatically based on the schedule. The third argument is the input passed to the workflow on each run.

Each `activate()` call creates a unique schedule instance. The instance is referenced by the workflow name, version, timing spec, and input. Activating the same schedule with different inputs creates independent instances, each with their own overlap tracking.

The same schedule spec can be bound to different workflows:

```typescript
const hourly = schedule({
	type: "interval",
	every: { hours: 1 },
});

// Schedule 2 different workflows to run hourly
await hourly.activate(aikiClient, inventorySyncV1);
await hourly.activate(aikiClient, pricingSyncV1);
```

## Schedule Types

### Cron

Use cron expressions for complex timing patterns:

```typescript
const dailyCleanup = schedule({
	type: "cron",
	expression: "0 0 * * *", // Midnight every day
});

const weeklyReport = schedule({
	type: "cron",
	expression: "0 9 * * 1", // 9 AM every Monday
	timezone: "America/New_York", // Optional timezone (default: UTC)
});
```

### Interval

Use intervals for simple recurring patterns:

```typescript
const hourlySync = schedule({
	type: "interval",
	every: { hours: 1 },
});

const frequentCheck = schedule({
	type: "interval",
	every: { minutes: 15 },
});
```

The `every` field accepts a duration object with `milliseconds`, `seconds`, `minutes`, `hours`, and `days`.

## Overlap Policy

When a schedule triggers but a previous run is still active, the overlap policy determines what happens:

```typescript
const syncSchedule = schedule({
	type: "interval",
	every: { minutes: 5 },
	overlapPolicy: "skip", // Skip if previous run is still active
});
```

| Policy | Behavior |
|--------|----------|
| `"allow"` (default) | Start a new run regardless of active runs |
| `"skip"` | Skip this occurrence if a run is still active |
| `"cancel_previous"` | Cancel the active run and start a new one |

Overlap policies are evaluated per schedule instance, not globally. If you activate the same schedule for multiple tenants with different inputs, each tenant has independent overlap handling.

## Idempotent Activation

Calling `activate()` is idempotent. If a schedule already exists with the same parameters, the existing schedule is returned unchanged.

If you call `activate()` with a **different input or timing configuration** (such as a new cron expression or interval), the existing schedule is updated with the new values.

## Reference IDs

By default, schedule identity is derived from a hash of the workflow name, version, timing spec, and input. You can provide an explicit reference ID instead:

```typescript
const handle = await dailyReport
	.with()
	.opt("reference.id", "tenant-acme-daily-report")
	.activate(client, reportWorkflowV1, { tenantId: "acme" });
```

Reference IDs are useful when you need a stable, predictable identifier for lookups or external integrations.

### Conflict Policy

When activating a schedule with a reference ID that already exists, the conflict policy determines what happens:

```typescript
const handle = await dailyReport
	.with()
	.opt("reference", {
		id: "my-schedule",
		conflictPolicy: "error",
	})
	.activate(client, workflowV1, input);
```

| Policy | Behavior |
|--------|----------|
| `"upsert"` (default) | Update the existing schedule if parameters differ |
| `"error"` | Throw an error if parameters differ from existing schedule |

With `"upsert"`, calling `activate()` with the same reference ID but different input or timing will update the existing schedule. With `"error"`, it throws a `ScheduleConflictError` if the parameters don't match.

For more on reference IDs in workflows and tasks, see the [Reference IDs guide](../guides/reference-ids.md).

## Managing Schedules

The handle returned from `activate()` lets you manage the schedule:

```typescript
const handle = await mySchedule.activate(aikiClient, workflowV1);

await handle.pause();  // Stop triggering
await handle.resume(); // Resume triggering
await handle.delete(); // Remove schedule
```

| Property/Method | Description |
|-----------------|-------------|
| `id` | Unique identifier for this schedule |
| `pause()` | Stop triggering |
| `resume()` | Resume triggering |
| `delete()` | Remove schedule |

## Multi-Tenant Schedules

For multi-tenant applications, activate the same schedule with different inputs for each tenant. Each activation creates an independent schedule instance:

```typescript
const dailyReport = schedule({
	type: "cron",
	expression: "0 9 * * *",
	overlapPolicy: "skip",
});

// Each tenant gets an independent schedule instance
await dailyReport.activate(client, reportWorkflowV1, { tenantId: "acme" });
await dailyReport.activate(client, reportWorkflowV1, { tenantId: "globex" });

// These are completely independent:
// - If Acme's report is still running, Globex's report starts normally
// - The "skip" policy only skips Acme's next run, not Globex's
```

## Next Steps

- **[Workflows](./workflows.md)** - Define the workflows your schedules trigger
- **[Workers](./workers.md)** - Run workers to execute scheduled workflows
