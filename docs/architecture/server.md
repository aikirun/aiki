# Server

The Aiki server coordinates workflow execution. It receives requests from SDK clients, persists workflow state, publishes work to Redis streams, and runs background jobs that drive workflow state transitions.

## What the Server Does

### Request Handling

The server exposes an RPC API that the SDK client calls to:

- **Create workflow runs** - Validate input, persist state, publish to Redis stream
- **Update workflow state** - Process state transitions from workers
- **Update task state** - Record task results and failures
- **Send events** - Deliver events to waiting workflows
- **Query runs** - List and filter workflow runs

### Work Distribution

When a workflow run is ready for execution, the server publishes a message to the appropriate Redis stream. Workers subscribed to that stream pick up the work. See [Redis Streams](./redis-streams.md) for details.

### Background Jobs

The server runs periodic jobs that drive workflow state transitions:

| Job | Purpose |
|-----|---------|
| Queue scheduled runs | Move scheduled workflow runs to the queue when their start time arrives |
| Wake sleeping workflows | Resume workflows whose sleep duration has elapsed |
| Retry workflows | Re-queue workflows in `awaiting_retry` state when their retry delay expires |
| Retry tasks | Re-queue workflows with tasks in `awaiting_retry` state |
| Timeout event waits | Fail or resume workflows that timed out waiting for events |
| Timeout child waits | Handle workflows that timed out waiting for child workflows |

## Configuration

The server requires:

- **Port** - HTTP port to listen on
- **Redis** - Connection for publishing workflow messages

```bash
# .env
AIKI_PORT=9876
REDIS_HOST=localhost
REDIS_PORT=6379
```

## Next Steps

- **[Redis Streams](./redis-streams.md)** - How work is distributed
- **[Overview](./overview.md)** - High-level architecture
