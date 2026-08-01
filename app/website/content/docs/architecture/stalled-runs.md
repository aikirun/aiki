---
title: Stalled Runs
---

A run **stalls** when the server gives up trying to deliver it. The run sat ready for longer than the retention cap (`maxAgeMs`, 24 hours by default) with no executor taking it. Stalling stops an undeliverable backlog from growing and stops the redelivery churn — the alternative would be re-offering the run forever.

`stalled` is not a failure and not a cancellation: the workflow never ran out of retries and nobody asked it to stop — it could not be *delivered*. The usual causes are operational: no worker is listening for that workflow, or the worker fleet was down for longer than the cap.

## What a stalled run does

- **It is not terminal.** A stalled run is recoverable. Callers waiting on a terminal status keep waiting, and a parent workflow waiting on a stalled child stays blocked until the child is requeued or cancelled — the child has produced no result yet, so the parent should wait.
- **Schedules see it as present.** A recurring schedule with a `skip` overlap policy does not start a second occurrence beside a stalled one. The fix for a stalled occurrence is to requeue it, not to run a duplicate next to it.
- **Nothing retries it automatically.** A stall is a signal that wants a human or an explicit policy. Recovery is a deliberate action, not a timer.

## Requeueing

Requeue a stalled run from the dashboard — the **Requeue** button on the run page.

The run re-enters delivery like any other scheduled run, with a fresh retention clock — a requeued run gets the full `maxAgeMs` again. The other exit is cancellation: a stalled run can be cancelled like any non-terminal run.

## Configuration

The sweep that stalls over-age runs is a server daemon; the cap lives in the server runtime config:

| Option | Default | Description |
|--------|---------|-------------|
| `daemons.stallUndeliverableRuns.maxAgeMs` | 86,400,000 (24h) | How long a run may sit undelivered before it stalls |

## Next Steps

- **[Workflow Run Claims](./workflow-run-claims.md)** — what happens when an executor dies mid-execution
- **[Server](./server.md)** — the daemons that deliver and retire runs
- **[Workers](../core-concepts/workers.md)** — worker configuration
