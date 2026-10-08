---
title: Schedules
description: Trigger workflows on a cron expression or interval, with overlap policy and run options.
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
| `"allow"` | Start a new run regardless of active runs |
| `"skip"` (default) | Skip this occurrence if a run is still active |
| `"cancel_previous"` | Cancel the active run and start a new one |

The policy also decides what happens to the occurrences a schedule missed, whether because the server was down or because the schedule was paused. `"allow"` runs every missed occurrence, oldest first, working through a large backlog in batches rather than all at once. `"skip"` and `"cancel_previous"` run only the most recent one. A [deactivated](#managing-schedules) schedule is different: the occurrences that fall while it is deactivated never run, under any policy.

Overlap policies are evaluated per schedule instance, not globally. If you activate the same schedule for multiple tenants with different inputs, each tenant has independent overlap handling.

## Run Options

A schedule fires runs of the workflow you hand to `activate()`, and those runs carry that workflow's options — whatever it declared at definition time, plus anything you set via `with()`. Configure the workflow, not the schedule:

```typescript
const hourlySync = schedule({
	type: "interval",
	every: { hours: 1 },
});

await hourlySync.activate(
	client,
	inventorySyncV1
		.with("retry", { type: "exponential", maxAttempts: 3, baseDelayMs: 1000 })
		.with("pool", "foo-bar")
);
```

Only `retry`, `pool`, and `priority` travel this way. `reference` or `delay` answers something about one particular run — which run it is, when execution begins — and a schedule fires a fresh run every tick, so passing a workflow that carries either will not compile. See [Workflow Options](./workflows.md#workflow-options).

Run options are part of a schedule's identity, so changing them is a different schedule — or, with a [reference ID](#reference-ids), a conflict.

## Idempotent Activation

Calling `activate()` is idempotent. If a schedule already exists with the same parameters, the existing schedule is returned unchanged.

If you call `activate()` with a **different input or timing configuration** (such as a new cron expression or interval), that is a different schedule identity: you are activating a new schedule, not modifying the first. A schedule's definition is immutable — there is no in-place edit. To change the timing or input, activate the new definition (a new schedule) and [deactivate](#managing-schedules) the old one. A [reference ID](#reference-ids) gives a schedule a stable identity for lookups.

## Reference IDs

By default, schedule identity is derived from a hash of the workflow name, version, timing spec, input, and [run options](#run-options). You can provide an explicit reference ID instead:

```typescript
const handle = await dailyReport
	.with("reference.id", "tenant-acme-daily-report")
	.activate(client, reportWorkflowV1, { tenantId: "acme" });
```

Reference IDs are useful when you need a stable, predictable identifier for lookups or external integrations.

### Conflict Policy

When activating a schedule with a reference ID that already identifies a schedule with a different definition, the conflict policy determines what happens:

```typescript
const handle = await dailyReport
	.with("reference", {
		id: "my-schedule",
		conflictPolicy: "error",
	})
	.activate(client, workflowV1, input);
```

| Policy | Behavior |
|--------|----------|
| `"error"` (default) | Throw an error with code `SCHEDULE_CONFLICT` if the reference ID already identifies a schedule with a different definition |
| `"return_existing"` | Return the existing schedule unchanged |

The definition is immutable, so a reference ID that already points at a different definition is a conflict, not an update. With `"error"` the activation throws an error whose `code` is `"SCHEDULE_CONFLICT"`; with `"return_existing"` it returns the existing schedule as-is. Re-activating with the *same* definition is idempotent: it returns the existing schedule. If that schedule is paused, re-activating does not resume it; only `resume()` does. If the schedule was deactivated, re-activating brings it back and it [starts again from its next occurrence](#managing-schedules).

### One Schedule per Definition

A reference ID does not replace the definition as a schedule's identity. It is a second name for it. A definition has one schedule, and that schedule has at most one reference ID. A deactivated schedule keeps both: deactivating frees neither its definition nor its reference ID.

| Activating with | Result |
|-----------------|--------|
| The same reference ID and the same definition | Returns the schedule, and brings it back if it was deactivated |
| The same reference ID and a different definition | The [conflict policy](#conflict-policy) decides |
| A new reference ID and a new definition | Creates a schedule |
| A new reference ID and a definition that already has a schedule under another reference ID | Throws an error with code `SCHEDULE_CONFLICT`, whatever the conflict policy |
| A reference ID and a definition whose schedule has none | That schedule takes the reference ID |
| No reference ID | Finds the schedule by its definition, whether or not it has a reference ID |

The reason is the schedule's history. A schedule says which workflow version it starts, with which input and options, on which timetable and overlap policy, and every run it created was created under that. An in-place edit, or a second schedule for the same definition, would leave history that no longer matches the schedule.

For more on reference IDs in workflows and events, see the [Reference IDs guide](../guides/reference-ids.md).

## Managing Schedules

The handle returned from `activate()` lets you manage the schedule:

```typescript
const handle = await mySchedule.activate(aikiClient, workflowV1);

await handle.pause();      // Stop triggering until resumed
await handle.resume();     // Resume a paused schedule
await handle.deactivate(); // Stop triggering until activated again
```

| Property/Method | Description |
|-----------------|-------------|
| `id` | Unique identifier for this schedule |
| `pause()` | Stop triggering until resumed. Rejected on a deactivated schedule |
| `resume()` | Resume a paused schedule. Rejected on a deactivated schedule; `activate()` brings it back |
| `deactivate()` | Stop triggering until activated again |

Pausing and deactivating both stop a schedule from triggering. They differ in how the schedule comes back and in what happens to the occurrences that fell in between:

| | Comes back with | Occurrences in between |
|---|---|---|
| `pause()` | `resume()` | Run as the [overlap policy](#overlap-policy) decides |
| `deactivate()` | `activate()` with the same definition | Never run |

A schedule activated again after being deactivated starts the way a new one does: an interval schedule runs one interval after the activation, and a cron schedule runs the next time its expression matches.

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
