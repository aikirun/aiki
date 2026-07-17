---
title: Workflow Run Claims
---

An executor — a worker or a serverless endpoint — owns a workflow run by **claiming** it. The claim guarantees a single live owner: while one executor holds a run, no other executor runs it. If the owner dies mid-execution, the server hands the run to a healthy executor, which resumes from the last checkpoint.

Claims are driven by the server and work the same regardless of how a run was delivered. A worker claiming over HTTP or Redis and an endpoint receiving a signed HTTP push hold and refresh the claim identically.

## Claim Refresh

While executing a run, the executor periodically refreshes its claim on the server to keep it alive. If the executor crashes, the refreshes stop and the claim eventually goes stale.

The refresh interval is configured on the worker or endpoint:

| Option | Default | Description |
|--------|---------|-------------|
| `workflowRun.claimRefreshIntervalMs` | 30,000 | How often the executor refreshes its claim (ms) |

A claim refresh is separate from a subscriber's optional `heartbeat`, which renews a run in the subscriber's own transport (e.g. an SQS visibility timeout). See [Subscribers](./subscribers.md).

## Work Stealing

When an executor crashes mid-execution:

1. The run's claim goes stale (no refreshes)
2. After `claimMinIdleTimeMs`, the run is up for grabs again — the claim API hands it to the next claiming worker, and when a publisher is configured, the server's republish daemon also puts it back on the queue
3. A healthy executor picks up the orphaned run
4. The workflow re-executes from its last checkpoint

**`claimMinIdleTimeMs`** is a server-side threshold, 90 seconds by default. It's how long the server waits after the last claim refresh before treating a run as abandoned. Keep it above the claim refresh interval, so a run only goes idle when an executor actually stops refreshing. The default 90 seconds against 30-second refreshes leaves ample margin. The republish-stale-runs daemon reads it from the server runtime config under `daemons.republishStaleRuns`; the claim API applies the same 90-second default when reclaiming runs directly. See [Runtime Configuration](../guides/configuration.md).

## Zombie Executor Prevention

Work stealing assumes the original executor is dead, but what if it's just slow? An executor presumed dead might wake up and try to continue executing a run that another has already claimed.

Aiki handles this through **revision-based optimistic locking**. Every workflow run has a `revision` counter that increments on each state transition. When an executor transitions a run to running, the revision increments. Every subsequent operation the executor performs — state transitions, task updates — includes the `expectedRevision` it last saw. The server atomically checks that the current revision matches before applying the update.

When Executor B steals a run from Executor A:

1. Executor A holds the run at `revision: 5`
2. Executor B claims the run and transitions it to running, incrementing to `revision: 6`
3. Executor A wakes up and tries to report a task result with `expectedRevision: 5`
4. The server rejects the update — the revision is now `6`
5. Executor A receives a revision conflict error and stops execution cleanly

This check happens at the database level in a single atomic operation (check revision + increment revision + apply update), so there's no race condition window.

## Safe Re-execution

When a claimed workflow re-executes:

- **Tasks return cached results** — already-completed tasks don't run again
- **State is preserved** — the workflow resumes from its persisted state

Work stealing is safe. Re-executing a workflow doesn't cause duplicate side effects for properly designed tasks. [Crash Recovery](./cam.md) covers how replay returns recorded task results.

## Next Steps

- **[Workers](../core-concepts/workers.md)** — Worker configuration
- **[Subscribers](./subscribers.md)** — Work discovery and delivery
- **[Server](./server.md)** — Orchestration and recovery daemons
- **[Crash Recovery](./cam.md)** — The replay mechanism behind safe re-execution
