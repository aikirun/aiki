# Redis Streams

Aiki uses Redis Streams for high-performance, fault-tolerant message distribution between the server and workers.

## Why Redis Streams?

- **High Performance** - Millions of messages per second
- **Fault Tolerance** - Built-in message claiming (XPENDING/XCLAIM)
- **Consumer Groups** - Automatic work distribution
- **Persistence** - Messages survive Redis restarts
- **Parallel Processing** - Multiple streams processed concurrently

## Stream Organization

### Stream Naming

One stream per workflow type:

```
workflow:order-processing
workflow:user-onboarding
workflow:email-sending
```

With sharding:

```
workflow:order-processing:us-east
workflow:order-processing:eu-west
```

### Consumer Groups

Each worker belongs to a consumer group:

```
Group: aiki-workers
Consumer: worker-1
Consumer: worker-2
Consumer: worker-3
```

Messages are distributed across consumers automatically.

## Key Operations

### XREADGROUP - Message Retrieval

Workers read messages using XREADGROUP:

```redis
XREADGROUP GROUP aiki-workers worker-1
  BLOCK 1000
  COUNT 10
  STREAMS workflow:orders >
```

**Parameters:**
- `GROUP`: Consumer group name
- `worker-1`: Consumer ID (worker ID)
- `BLOCK 1000`: Wait 1 second for messages
- `COUNT 10`: Read up to 10 messages
- `>`: Only new messages

**Parallel reads:**

```typescript
const results = await Promise.allSettled(
  streams.map(stream =>
    redis.xreadgroup(
      "GROUP", "aiki-workers", workerId,
      "BLOCK", blockTimeMs,
      "COUNT", batchSize,
      "STREAMS", stream, ">"
    )
  )
);
```

### XPENDING - Stuck Message Detection

Identify messages from failed workers:

```redis
XPENDING workflow:orders aiki-workers
  - + 100
  claimMinIdleTimeMs
```

**Returns:**
- Messages idle > `claimMinIdleTimeMs`
- Consumer that claimed the message
- Idle time for each message
- Delivery count

**Parallel scanning:**

```typescript
const pendingResults = await Promise.allSettled(
  streams.map(stream =>
    redis.xpending(
      stream,
      "aiki-workers",
      "-", "+", 100,
      workerId
    )
  )
);
```

### XCLAIM - Message Recovery

Claim stuck messages from failed workers:

```redis
XCLAIM workflow:orders aiki-workers worker-2
  claimMinIdleTimeMs
  <message-id>
```

**Process:**
1. Find stuck messages with XPENDING
2. Filter by idle time
3. Claim ownership with XCLAIM
4. Re-execute workflow

**Parallel claiming:**

```typescript
const claimResults = await Promise.allSettled(
  messagesToClaim.map(({ stream, messageId }) =>
    redis.xclaim(
      stream,
      "aiki-workers",
      workerId,
      claimMinIdleTimeMs,
      messageId
    )
  )
);
```

## Message Format

### Workflow Run Message

```json
{
  "id": "run-123",
  "workflowName": "order-processing",
  "version": "1.0.0",
  "payload": {
    "orderId": "order-456",
    "amount": 99.99
  },
  "idempotencyKey": "order-456-process",
  "createdAt": 1234567890
}
```

### Message Lifecycle

```
1. Server → XADD: Publish message
2. Worker → XREADGROUP: Read message
3. Worker: Process workflow
4. Worker → XACK: Acknowledge completion
5. Redis: Remove from pending list
```

## Fault Tolerance

### Dead Worker Detection

```
1. Worker-1 crashes during execution
2. Message remains in pending list
3. XPENDING shows message idle > 60s
4. Worker-2 sees idle message
5. Worker-2 executes XCLAIM
6. Worker-2 processes workflow
```

### Message Claiming Flow

```typescript
// Find stuck messages
const pending = await redis.xpending(
  stream,
  group,
  "-", "+", 100
);

// Filter by idle time
const stuckMessages = pending.filter(msg =>
  msg.idle > claimMinIdleTimeMs
);

// Claim messages
for (const msg of stuckMessages) {
  await redis.xclaim(
    stream,
    group,
    workerId,
    claimMinIdleTimeMs,
    msg.id
  );
}
```

### Idempotency

Messages may be processed multiple times:

- Worker crashes after processing but before ACK
- Message is claimed and re-processed
- Idempotency keys prevent duplicate execution

## Performance Optimizations

### Parallel Operations

```typescript
// Read from multiple streams in parallel
const reads = streams.map(stream =>
  redis.xreadgroup(...)
);
await Promise.allSettled(reads);

// Claim from multiple streams in parallel
const claims = messages.map(msg =>
  redis.xclaim(...)
);
await Promise.allSettled(claims);
```

### Stream Shuffling

Randomize stream order for fairness:

```typescript
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

const shuffledStreams = shuffleArray([...streams]);
```

### Batch Size Distribution

Round-robin batch sizes:

```typescript
const batchSizes = distributeBatchSize(
  totalBatchSize,
  streamCount
);

// [5, 5] for totalBatchSize=10, streamCount=2
// [4, 3, 3] for totalBatchSize=10, streamCount=3
```

### Connection Pooling

Reuse Redis connections:

```typescript
const redis = new Redis({
  host: "localhost",
  port: 6379,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false
});
```

## Configuration

### Server-Side

```typescript
// Publish workflow run
await redis.xadd(
  `workflow:${workflowName}`,
  "*",
  "data", JSON.stringify(workflowRun)
);
```

### Worker-Side

```typescript
const worker = await worker(client, {
  subscriber: {
    type: "redis_streams",
    claimMinIdleTimeMs: 60_000,   // Claim after 60s
    blockTimeMs: 1000,            // Block for 1s
    batchSize: 10                 // Read 10 messages
  }
});
```

## Monitoring

### Stream Metrics

```bash
# Stream length
XLEN workflow:orders

# Pending messages
XPENDING workflow:orders aiki-workers

# Consumer info
XINFO CONSUMERS workflow:orders aiki-workers
```

### Health Checks

```typescript
// Check Redis connection
const ping = await redis.ping();

// Check stream exists
const length = await redis.xlen(streamName);

// Check consumer group exists
const groups = await redis.xinfo("GROUPS", streamName);
```

## Best Practices

1. **Set Appropriate Claim Times** - Balance recovery speed vs duplicate work
2. **Monitor Pending Messages** - Track stuck messages
3. **Use Idempotency Keys** - Prevent duplicate execution
4. **Configure Persistence** - Enable AOF/RDB for Redis
5. **Tune Batch Sizes** - Balance throughput and latency
6. **Parallel Processing** - Process multiple streams concurrently

## Next Steps

- **[Workers](./workers.md)** - Worker architecture details
- **[Server](./server.md)** - Server architecture
- **[Overview](./overview.md)** - High-level architecture
