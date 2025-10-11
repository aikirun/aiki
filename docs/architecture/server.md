# Aiki Server

The Aiki Server is the central orchestration component that manages workflow lifecycle, state persistence, and coordination with workers.

## Responsibilities

### Workflow Management

- Store and version workflow definitions
- Create and track workflow runs
- Manage workflow state transitions
- Coordinate workflow execution

### Task Management

- Track task execution status
- Store task results and metadata
- Handle task dependencies
- Manage task retries

### State Persistence

- Persist workflow definitions
- Store workflow run state
- Maintain task execution history
- Provide audit trail

### Queue Coordination

- Distribute work to available workers
- Monitor worker health
- Track execution metrics
- Manage message delivery

## Components

### Workflow Orchestration

Manages workflow lifecycle:

```
Workflow Start → Validation → State Creation → Queue Publish → Monitoring
```

**Key operations:**
- Validate workflow definitions
- Create workflow run records
- Publish to Redis Streams
- Track workflow state
- Handle completions and failures

### Task Management

Tracks task execution:

```
Task Start → Record Creation → Execution Tracking → Result Storage
```

**Key operations:**
- Record task attempts
- Store task results
- Track task failures
- Manage retry logic

### Storage Layer

Persists all state:

**Stored Data:**
- Workflow definitions and versions
- Workflow run instances
- Task execution records
- Worker heartbeats
- Audit logs

**Storage Options:**
- PostgreSQL (recommended)
- MySQL
- Other relational databases

## API Endpoints

### Workflow Operations

```typescript
// Start workflow
POST /workflows/:name/versions/:version/start
{
  "payload": {...},
  "idempotencyKey": "optional-key"
}

// Get workflow run status
GET /workflow-runs/:id/status

// Cancel workflow run
POST /workflow-runs/:id/cancel
```

### Monitoring Operations

```typescript
// List workflow runs
GET /workflows/:name/runs

// Get task execution details
GET /workflow-runs/:id/tasks

// Get worker health
GET /workers/:id/health
```

## Configuration

### Environment Variables

```bash
# Server
PORT=9090
HOST=0.0.0.0

# Database
DATABASE_URL=postgresql://user:pass@localhost/aiki

# Redis
REDIS_URL=redis://localhost:6379

# Security
API_KEY=your-secret-key
TLS_ENABLED=true
```

### Server Options

```typescript
const server = await createServer({
  port: 9090,
  database: {
    url: process.env.DATABASE_URL,
    poolSize: 20
  },
  redis: {
    url: process.env.REDIS_URL
  },
  security: {
    apiKey: process.env.API_KEY,
    cors: {
      origin: ["https://app.example.com"]
    }
  }
});
```

## State Management

### Workflow Run States

```
pending → running → completed
                 → failed
                 → cancelled
```

**State transitions:**
- `pending` → `running`: Worker picks up workflow
- `running` → `completed`: All tasks succeed
- `running` → `failed`: Unrecoverable error
- `any` → `cancelled`: Manual cancellation

### Task States

```
pending → running → completed
                 → failed → retrying → running
```

**Retry logic:**
- Exponential backoff
- Maximum retry attempts
- Task-level retry configuration (planned)

## Monitoring

### Metrics

The server exposes metrics for monitoring:

```
# Workflow metrics
aiki_workflows_started_total
aiki_workflows_completed_total
aiki_workflows_failed_total
aiki_workflow_duration_seconds

# Task metrics
aiki_tasks_started_total
aiki_tasks_completed_total
aiki_tasks_failed_total
aiki_tasks_retried_total

# Worker metrics
aiki_workers_active
aiki_workers_heartbeat_age_seconds
```

### Health Checks

```bash
# Server health
GET /health

# Database health
GET /health/database

# Redis health
GET /health/redis
```

## Security

### Authentication

The server supports multiple authentication methods:

```typescript
// API Key
headers: {
  "X-API-Key": "your-api-key"
}

// JWT (planned)
headers: {
  "Authorization": "Bearer <token>"
}
```

### Authorization

Role-based access control:

```
- admin: Full access
- worker: Start/update workflow runs
- client: Start workflows, read status
```

### Encryption

- TLS for all network traffic
- Database encryption at rest
- Redis encryption in transit

## Deployment

### Docker

```bash
docker run -d \
  --name aiki-server \
  -p 9090:9090 \
  -e DATABASE_URL=postgresql://... \
  -e REDIS_URL=redis://... \
  aiki/server:latest
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: aiki-server
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: aiki-server
        image: aiki/server:latest
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: aiki-secrets
              key: database-url
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: aiki-secrets
              key: redis-url
```

## High Availability

### Server Redundancy

- Run multiple server instances
- Use load balancer for distribution
- Session affinity not required
- Stateless server design

### Database

- Use managed database service
- Configure read replicas
- Enable automatic backups
- Set up failover

### Redis

- Use Redis Cluster
- Configure persistence (AOF/RDB)
- Enable replication
- Monitor memory usage

## Next Steps

- **[Workers](./workers.md)** - Worker architecture details
- **[Redis Streams](./redis-streams.md)** - Message distribution
- **[Overview](./overview.md)** - High-level architecture
