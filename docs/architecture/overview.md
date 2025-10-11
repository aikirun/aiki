# Architecture Overview

Aiki follows a distributed architecture where workflow orchestration is separated from execution. This provides security, scalability, and flexibility.

## System Design

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Your Application                               │
│                    (Uses Aiki SDK to start workflows)                       │
└─────────────────────────────────────┬───────────────────────────────────────┘
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
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      │ Redis Streams
                                      ▼
                     ┌───────────────────────────────────┐
                     │         Redis Cluster             │
                     │  ┌─────────────────────────────┐  │
                     │  │  Stream 1: workflow:orders  │  │
                     │  │  Stream 2: workflow:users   │  │
                     │  └─────────────────────────────┘  │
                     └───────────────────────────────────┘
                                      │
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

Your application uses the Aiki SDK to define workflows and tasks, start workflow runs, monitor execution status, and retrieve results.

### 2. Aiki Server

The Aiki Server orchestrates workflows and manages state through three key functions: workflow orchestration manages the workflow lifecycle, task management tracks task execution, and the storage layer persists state and history.

### 3. Redis Streams

Redis Streams provides high-performance message distribution using consumer groups for work distribution, message claiming for fault tolerance, parallel stream processing, and round-robin work allocation.

⚠️ **Note**: Redis Streams is currently the only fully implemented subscriber strategy.

### 4. Workers

Workers execute workflows in your infrastructure by polling for workflow runs, executing tasks in sequence, reporting results to the server, and handling retries and failures.

## Design Principles

### Separation of Concerns

Aiki separates orchestration (handled by the Aiki Server), execution (handled by workers in your environment), state management (centralized in storage), and communication (through Redis Streams).

### Security by Design

Security is built into the architecture: your code runs exclusively on your infrastructure, the Aiki server never executes your code, all traffic uses TLS encryption, and your data never leaves your environment.

### Fault Tolerance

The system achieves fault tolerance through state persistence that allows workflows to survive restarts, message claiming that lets workers claim stuck workflows, automatic retries for failed tasks, and graceful degradation that keeps the system running with reduced capacity.

### Event-Driven Architecture

Components communicate through events, creating loose coupling between server and workers. This enables scalable message distribution and reliable event delivery.

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

Deploy all components in your infrastructure for full control over deployment, custom security policies, integration with existing systems, and no vendor lock-in. This requires running the Aiki Server (Docker/VM), Redis for streams, PostgreSQL for storage, and workers in your infrastructure.

### Cloud-Based

Use a managed Aiki service that handles the server and Redis with automatic scaling, built-in monitoring, and reduced operational overhead. You're responsible for running workers in your cloud account and optionally managing your storage.

### Hybrid

Combine self-hosted and managed components for flexibility in deployment, cost optimization, meeting compliance requirements, and geographic distribution.

## Scalability

### Horizontal Scaling

Scale horizontally by adding more workers to increase throughput, scaling server instances for high availability, using Redis Cluster for distributed streams, and implementing read replicas and sharding for storage.

### Performance Optimization

Optimize performance by caching frequently accessed data, using connection pooling to reuse database connections, batch processing multiple items together, and leveraging async processing for non-blocking operations.

## Security Considerations

### Network Security

Protect network communications with TLS encryption for all communication, authentication for API access, role-based access control, and network isolation through VPC or firewall rules.

### Data Security

Secure data with encryption at rest for stored data, encryption in transit for network traffic, data residency controls, and access logging and auditing.

### Execution Security

Ensure execution security through code isolation in worker environments, resource limits to prevent exhaustion, sandboxing to limit system access, and regular security updates.

## Next Steps

- **[Server](./server.md)** - Server component details
- **[Workers](./workers.md)** - Worker architecture deep dive
- **[Redis Streams](./redis-streams.md)** - Message distribution specifics
