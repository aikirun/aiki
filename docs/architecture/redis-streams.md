# Redis Streams

Aiki uses Redis Streams for work distribution and fault tolerance. This document explains how Aiki leverages streams, not how Redis Streams work (see the [official Redis documentation](https://redis.io/docs/data-types/streams/) for that).

## How Aiki Uses Streams

### Stream Per Workflow

Each workflow type gets its own stream:

```
workflow/order-processing/1.0.0
workflow/user-onboarding/1.0.0
workflow/email-sending/2.0.0
```

With sharding enabled:

```
workflow/order-processing/1.0.0/us-east
workflow/order-processing/1.0.0/eu-west
```

### Work Distribution

Workers use consumer groups to receive work:

- When a workflow is started, the server publishes a message to the appropriate stream
- Workers receive messages when they have capacity (automatic load balancing)
- Each message is delivered to exactly one worker in the consumer group
- No central coordinator assigns work; workers pull when ready

### Message Lifecycle

1. Server publishes workflow run message to stream
2. Worker receives message from consumer group
3. Worker executes workflow, sending periodic heartbeats to refresh its claim
4. Worker acknowledges message on completion
5. If worker crashes before acknowledging, message remains pending (heartbeats stop)

## Fault Tolerance

The key benefit of Redis Streams for Aiki is fault tolerance through message claiming.

### Work Stealing

When a worker crashes mid-execution:

1. The message stays in the pending list (unacknowledged)
2. Other workers periodically scan for idle messages
3. If a message has been idle longer than `claimMinIdleTimeMs`, any worker can claim it
4. The claiming worker takes over and re-executes the workflow

This "work stealing" ensures no workflow is lost due to worker failures.

### Safe Re-execution

When a claimed workflow re-executes:

- **Tasks return cached results** - Already-completed tasks don't run again
- **Reference IDs prevent duplicates** - External operations with reference IDs remain idempotent
- **State is preserved** - The workflow resumes from its persisted state

This means work stealing is safe. Re-executing a workflow doesn't cause duplicate side effects for properly designed tasks.

## Configuration

Configure stream behavior in worker options:

```typescript
const orderWorker = worker({
	name: "order-worker",
	workflows: [orderWorkflowV1],
	subscriber: {
		type: "redis",
		claimMinIdleTimeMs: 180_000, // Claim messages idle > 3 minutes
		blockTimeMs: 1000,           // Wait up to 1s for new messages
	},
});
```

| Option | Default | Description |
|--------|---------|-------------|
| `claimMinIdleTimeMs` | 180,000 | How long a message must be idle before other workers can claim it |
| `blockTimeMs` | 1,000 | How long to wait for new messages before checking for claimable work |

Heartbeat interval is configured separately in worker options:

| Option | Default | Description |
|--------|---------|-------------|
| `workflowRun.heartbeatIntervalMs` | 30,000 | How often workers refresh their claim on a message |

**Choosing `claimMinIdleTimeMs`**: Set this higher than the heartbeat interval. Workers refresh their claim every heartbeat, so a message only becomes "idle" when a worker stops heartbeating (crashes or hangs). The default of 3 minutes with 30-second heartbeats gives plenty of margin.

## Next Steps

- **[Workers](../core-concepts/workers.md)** - Worker configuration
- **[Overview](./overview.md)** - High-level architecture
