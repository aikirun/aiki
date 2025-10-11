# Architecture Overview

Aiki follows a distributed architecture where workflow orchestration is separated from execution. This provides security, scalability, and flexibility.

## System Design

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Your Application                               │
│                    (Uses Aiki SDK to start workflows)                       │
└─────────────────────┬───────────────────────────────────────────────────────┘
                      │
                      │ SDK Client
                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Aiki Server                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │  Workflow       │  │  Task           │  │  Storage Layer              │  │
│  │  Orchestration  │  │  Management     │  │  (Workflow Runs, Tasks,     │  │
│  │                 │  │                 │  │   Results, State)           │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
└─────────────────────┬───────────────────────────────────────────────────────┘
                      │
                      │ Redis Streams
                      ▼
            ┌───────────────────────────────────┐
            │         Redis Cluster             │
            │  ┌─────────────────────────────┐  │
            │  │  Stream 1: workflow:orders  │  │
            │  │  Stream 2: workflow:users   │  │
            │  │  (XPENDING/XCLAIM support)  │  │
            │  └─────────────────────────────┘  │
            └───────────────────────────────────┘
                      │
                      ▼
          ┌─────────────────────────────────────────────────────────┐
          │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
          │  │   Worker A  │  │   Worker B  │  │   Worker C  │      │
          │  │             │  │             │  │             │      │
          │  │ Executes    │  │ Executes    │  │ Executes    │      │
          │  │ Workflows   │  │ Workflows   │  │ Workflows   │      │
          │  │ in YOUR     │  │ in YOUR     │  │ in YOUR     │      │
          │  │ Environment │  │ Environment │  │ Environment │      │
          │  └─────────────┘  └─────────────┘  └─────────────┘      │
          │                                                         │
          │                    Your Infrastructure                  │
          └─────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Your Application

Uses the Aiki SDK to:
- Define workflows and tasks
- Start workflow runs
- Monitor execution status
- Retrieve results

### 2. Aiki Server

Orchestrates workflows and manages state:
- **Workflow Orchestration** - Manages workflow lifecycle
- **Task Management** - Tracks task execution
- **Storage Layer** - Persists state and history

### 3. Redis Streams

High-performance message distribution:
- Consumer groups for work distribution
- Message claiming for fault tolerance
- Parallel stream processing
- Round-robin work allocation

⚠️ **Note**: Redis Streams is currently the only fully implemented subscriber strategy.

### 4. Workers

Execute workflows in your infrastructure:
- Poll for workflow runs
- Execute tasks in sequence
- Report results to server
- Handle retries and failures

## Design Principles

### Separation of Concerns

- **Orchestration**: Handled by Aiki Server
- **Execution**: Handled by Workers in your environment
- **State Management**: Centralized in storage
- **Communication**: Through Redis Streams

### Security by Design

- **Execution in Your Environment** - Code runs on your infrastructure
- **No Code Execution in Aiki** - Server never executes your code
- **Secure Communication** - TLS encryption for all traffic
- **Data Control** - Your data never leaves your environment

### Fault Tolerance

- **State Persistence** - Workflows survive restarts
- **Message Claiming** - Workers claim stuck workflows
- **Automatic Retries** - Failed tasks are retried
- **Graceful Degradation** - System continues with reduced capacity

### Event-Driven Architecture

- Components communicate through events
- Loose coupling between server and workers
- Scalable message distribution
- Reliable event delivery

## Data Flow

### 1. Starting a Workflow

```
Application → SDK Client → Aiki Server → Storage
                                    ↓
                                Redis Streams
```

1. Application calls `workflowVersion.start()`
2. SDK client sends request to server
3. Server validates and creates workflow run
4. Server stores run in database
5. Server publishes message to Redis Streams
6. Returns result handle to client

### 2. Workflow Execution

```
Redis Streams → Worker → Task Execution → Server
```

1. Worker polls Redis Streams for workflow runs
2. Worker receives workflow run message
3. Worker loads workflow definition
4. Worker executes tasks in sequence
5. Worker reports results to server
6. Server updates state in storage

### 3. State Synchronization

```
Worker ←→ Server ←→ Storage
```

1. Worker sends heartbeat to server
2. Server updates worker status
3. Server publishes workflow updates
4. Other workers receive updates if needed

## Deployment Models

### Self-Hosted

Deploy all components in your infrastructure:
- Full control over deployment
- Custom security policies
- Integration with existing systems
- No vendor lock-in

**Components:**
- Aiki Server (Docker/VM)
- Redis (for streams)
- PostgreSQL (for storage)
- Workers (your infrastructure)

### Cloud-Based

Use managed Aiki service:
- Managed server and Redis
- Automatic scaling
- Built-in monitoring
- Reduced operational overhead

**Your responsibility:**
- Workers (in your cloud account)
- Your storage (optional)

### Hybrid

Mix of self-hosted and managed:
- Flexibility in deployment
- Cost optimization
- Compliance requirements
- Geographic distribution

## Scalability

### Horizontal Scaling

- **Workers** - Add more workers to increase throughput
- **Server** - Scale server instances for high availability
- **Redis** - Use Redis Cluster for distributed streams
- **Storage** - Implement read replicas and sharding

### Performance Optimization

- **Caching** - Cache frequently accessed data
- **Connection Pooling** - Reuse database connections
- **Batch Processing** - Process multiple items together
- **Async Processing** - Non-blocking operations

## Security Considerations

### Network Security

- TLS encryption for all communication
- Authentication for API access
- Role-based access control
- Network isolation (VPC/firewall)

### Data Security

- Encryption at rest for stored data
- Encryption in transit for network traffic
- Data residency controls
- Access logging and auditing

### Execution Security

- Code isolation in worker environments
- Resource limits to prevent exhaustion
- Sandboxing to limit system access
- Regular security updates

## Next Steps

- **[Server](./server.md)** - Server component details
- **[Workers](./workers.md)** - Worker architecture deep dive
- **[Redis Streams](./redis-streams.md)** - Message distribution specifics
