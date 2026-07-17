---
title: Schedules
---

A schedule automatically triggers workflows at defined times or intervals. Use schedules for recurring jobs like daily reports, hourly syncs, or cron-based maintenance tasks.

## Creating a Schedule

```typescript
import { client } from "@aikirun/client";
import { schedule } from "@aikirun/workflow";
import { dailyReportWorkflowV1 } from "./workflows";

const aikiClient = client({
	url: "http://localhost:9850",
	apiKey: "your-api-key",
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

Each `activate()` call creates a unique schedule instance, identified by the workflow name, version, timing spec, input, and [run options](#run-options). Activating the same schedule with different inputs creates independent instances, each with their own overlap tracking.

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

## Run Options

A workflow definition can declare default start options, such as its `retry` strategy. A schedule sets the start options for the runs it fires:

```typescript
const hourlySync = schedule({
	type: "interval",
	every: { hours: 1 },
});

await hourlySync
	.with()
	.opt("workflowRun.retry", { type: "exponential", maxAttempts: 3, baseDelayMs: 1000 })
	.opt("workflowRun.shard", "eu")
	.activate(client, inventorySyncV1);
```

Only `retry` and `shard` can be set: a scheduled run's reference ID and trigger are the schedule's to control, not the caller's. Run options are part of a schedule's identity, so changing them is a different schedule — or, with a [reference ID](#reference-ids), a conflict.

## Idempotent Activation

Calling `activate()` is idempotent. If a schedule already exists with the same parameters, the existing schedule is returned unchanged.

If you call `activate()` with a **different input or timing configuration** (such as a new cron expression or interval), that is a different schedule identity: you are activating a new schedule, not modifying the first. A schedule's definition is immutable — there is no in-place edit. To change the timing or input, activate the new definition (a new schedule) and [deactivate](#managing-schedules) the old one. A [reference ID](#reference-ids) gives a schedule a stable identity for lookups.

## Reference IDs

By default, schedule identity is derived from a hash of the workflow name, version, timing spec, input, and [run options](#run-options). You can provide an explicit reference ID instead:

```typescript
const handle = await dailyReport
	.with()
	.opt("reference.id", "tenant-acme-daily-report")
	.activate(client, reportWorkflowV1, { tenantId: "acme" });
```

Reference IDs are useful when you need a stable, predictable identifier for lookups or external integrations.

### Conflict Policy

When activating a schedule with a reference ID that already identifies a schedule with a different definition, the conflict policy determines what happens:

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
| `"error"` (default) | Throw a `ScheduleConflictError` if the reference ID already identifies a schedule with a different definition |
| `"return_existing"` | Return the existing schedule unchanged |

The definition is immutable, so a reference ID that already points at a different definition is a conflict, not an update. With `"error"` the activation throws a `ScheduleConflictError`; with `"return_existing"` it returns the existing schedule as-is. Re-activating with the *same* definition is idempotent, and reactivates the schedule if it was paused.

For more on reference IDs in workflows and events, see the [Reference IDs guide](../guides/reference-ids.md).

## Managing Schedules

The handle returned from `activate()` lets you manage the schedule:

```typescript
const handle = await mySchedule.activate(aikiClient, workflowV1);

await handle.pause();      // Stop triggering
await handle.resume();     // Resume triggering
await handle.deactivate(); // Deactivate schedule
```

| Property/Method | Description |
|-----------------|-------------|
| `id` | Unique identifier for this schedule |
| `pause()` | Stop triggering |
| `resume()` | Resume triggering |
| `deactivate()` | Deactivate schedule |

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
