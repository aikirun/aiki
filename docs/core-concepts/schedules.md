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
	name: "daily-report",
	type: "cron",
	expression: "0 9 * * *", // Every day at 9 AM UTC
});

const handle = await dailyReport.register(
	aikiClient,
	dailyReportWorkflowV1,
	{ reportType: "sales" } // Workflow input
);
```

The `schedule()` function defines a timing configuration. Call `register()` to bind it to a workflow - the workflow will then trigger automatically based on the schedule. The third argument is the input passed to the workflow on each run.

The same schedule can be bound to different workflows:

```typescript
const hourly = schedule({
	name: "hourly",
	type: "interval",
	every: { hours: 1 },
});

// Schedule 2 different workflows to run hourly
await hourly.register(aikiClient, inventorySyncV1);
await hourly.register(aikiClient, pricingSyncV1);
```

## Schedule Types

### Cron

Use cron expressions for complex timing patterns:

```typescript
const dailyCleanup = schedule({
	name: "daily-cleanup",
	type: "cron",
	expression: "0 0 * * *", // Midnight every day
});

const weeklyReport = schedule({
	name: "weekly-report",
	type: "cron",
	expression: "0 9 * * 1", // 9 AM every Monday
	timezone: "America/New_York", // Optional timezone (default: UTC)
});
```

### Interval

Use intervals for simple recurring patterns:

```typescript
const hourlySync = schedule({
	name: "hourly-sync",
	type: "interval",
	every: { hours: 1 },
});

const frequentCheck = schedule({
	name: "frequent-check",
	type: "interval",
	every: { minutes: 15 },
});
```

The `every` field accepts a duration object with `milliseconds`, `seconds`, `minutes`, `hours`, and `days`.

## Overlap Policy

When a schedule triggers but a previous run is still active, the overlap policy determines what happens:

```typescript
const syncSchedule = schedule({
	name: "data-sync",
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

## Managing Schedule Registrations

The handle returned from `register()` lets you manage the registration:

```typescript
const handle = await mySchedule.register(aikiClient, workflowV1);

await handle.pause();  // Stop triggering
await handle.resume(); // Resume triggering
await handle.delete(); // Remove registration
```

| Property/Method | Description |
|-----------------|-------------|
| `id` | Unique identifier for this registration |
| `name` | The schedule name |
| `pause()` | Stop triggering |
| `resume()` | Resume triggering |
| `delete()` | Remove registration |

## Next Steps

- **[Workflows](./workflows.md)** - Define the workflows your schedules trigger
- **[Workers](./workers.md)** - Run workers to execute scheduled workflows
