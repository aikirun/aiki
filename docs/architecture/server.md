# Aiki Server

The Aiki Server is the central orchestration component that manages workflow lifecycle, state persistence, and
coordination with workers.

## Responsibilities

### Workflow Management

The server stores and versions workflow definitions, creates and tracks workflow runs, manages workflow state
transitions, and coordinates workflow execution.

### Task Management

Task management involves tracking task execution status, storing task results and metadata, handling task dependencies,
and managing task retries.

### State Persistence

The server persists workflow definitions, stores workflow run state, maintains task execution history, and provides an
audit trail.

### Queue Coordination

Queue coordination distributes work to available workers, monitors worker health, tracks execution metrics, and manages
message delivery.

## Components

### Workflow Orchestration

Manages workflow lifecycle:

```
Workflow Start → Validation → State Creation → Queue Publish → Monitoring
```

The orchestrator validates workflow definitions, creates workflow run records, publishes to the message queue,
tracks workflow state, and handles completions and failures.

### Task Management

Tracks task execution:

```
Task Start → Record Creation → Execution Tracking → Result Storage
```

Task management records task attempts, stores task results, tracks task failures, and manages retry logic.

### Storage Layer

Persists all state:

The storage layer maintains workflow definitions and versions, workflow run instances, task execution records, worker
heartbeats, and audit logs. PostgreSQL is recommended, though MySQL and other relational databases are also supported.

## API Endpoints

### Workflow Operations

```typescript
// Start workflow
POST /workflows/:name/versions/:version/start
{
  "payload": {...},
  "options": {
    "reference": { "id": "optional-reference-id" }
  }
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
AIKI_PORT=9876
AIKI_HOST=0.0.0.0

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
	port: 9876,
	database: {
		url: process.env.DATABASE_URL,
		poolSize: 20,
	},
	redis: {
		url: process.env.REDIS_URL,
	},
	security: {
		apiKey: process.env.API_KEY,
		cors: {
			origin: ["https://app.example.com"],
		},
	},
});
```

## State Management

### Workflow Run States

```
pending → running → completed
                 → failed
                 → cancelled
```

Workflow runs transition from `pending` to `running` when a worker picks them up, from `running` to `completed` when all
tasks succeed, from `running` to `failed` on unrecoverable errors, and from any state to `cancelled` on manual
cancellation.

### Task States

```
pending → running → completed
                 → failed → retrying → running
```

Task retry uses exponential backoff with maximum retry attempts. Task-level retry configuration is planned for a future
release.

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

The system uses role-based access control with three levels: admin for full access, worker for starting and updating
workflow runs, and client for starting workflows and reading status.

### Encryption

All network traffic uses TLS, databases are encrypted at rest, and the message queue uses encryption in transit.

## Deployment

### Docker

```bash
docker run -d \
  --name aiki-server \
  -p 9876:9876 \
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

Achieve server redundancy by running multiple server instances behind a load balancer. Session affinity isn't required
due to the stateless server design.

### Database

Use a managed database service with read replicas, automatic backups, and failover configured for high availability.

### Message Queue

For Redis (default): Deploy Redis Cluster with persistence configured (AOF/RDB), replication enabled, and memory usage monitored.

## Next Steps

- **[Workers](./workers.md)** - Worker architecture details
- **[Redis Streams](./redis-streams.md)** - Message distribution
- **[Overview](./overview.md)** - High-level architecture
