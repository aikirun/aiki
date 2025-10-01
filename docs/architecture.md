# Architecture

This document provides a deep dive into Aiki's architecture, design principles, and component interactions.

## Overview

Aiki follows a distributed architecture pattern where workflow orchestration is separated from workflow execution. This design provides several key benefits:

- **Security**: Your business logic runs in your controlled environment
- **Scalability**: Workers can be distributed across multiple machines
- **Reliability**: State persistence ensures workflows survive failures
- **Flexibility**: Support for various deployment models

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Your Application                               │
│                    (Uses Aiki SDK to enqueue workflows)                     │
└─────────────────────┬───────────────────────────────────────────────────────┘
                      │
                      │ SDK Client
                      │ (Enqueues workflows)
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
                      │ Redis Streams / Queue System
                      │ (High-performance message distribution with fault tolerance)
                      ▼
            ┌───────────────────────────────────┐
            │         Redis Cluster             │
            │  ┌─────────────────────────────┐  │
            │  │  Stream 1: workflow:orders  │  │
            │  │  Stream 2: workflow:users   │  │
            │  │  Stream 3: workflow:reports │  │
            │  │  (XPENDING/XCLAIM support)  │  │
            │  └─────────────────────────────┘  │
            └───────────────────────────────────┘
                      │
                      ▼
          ┌─────────────────────────────────────────────────────────┐
          │                                                         │
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
          │              (Your servers, containers, etc.)           │
          └─────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Your Application

Your application uses the Aiki SDK to:
- Define workflows and tasks
- Enqueue workflow runs
- Monitor workflow execution status
- Retrieve workflow results

**Key Benefits:**
- Type-safe workflow definitions
- Simple integration with existing code
- Cross-platform support (Node.js and Deno)

### 2. SDK Client

The SDK client provides a high-level interface for interacting with the Aiki Server:

**Responsibilities:**
- Workflow enqueueing
- Status monitoring
- Result retrieval
- Idempotency key management

**Features:**
- Automatic retry logic
- Connection pooling
- Error handling
- Type safety

### 3. Aiki Server

The Aiki Server is the central orchestration component that manages workflow lifecycle and state.

#### Server Components

**Workflow Orchestration:**
- Manages workflow definitions and versions
- Handles workflow run lifecycle
- Coordinates task execution
- Manages workflow state transitions

**Task Management:**
- Tracks task execution status
- Manages task retries and failures
- Stores task results and metadata
- Handles task dependencies

**Storage Layer:**
- Persists workflow definitions
- Stores workflow run state
- Maintains task execution history
- Provides audit trail

#### Server Responsibilities

- **State Management**: Maintains consistent workflow state
- **Queue Coordination**: Distributes work to available workers
- **Monitoring**: Tracks execution metrics and health
- **API Management**: Provides REST/gRPC interfaces
- **Security**: Handles authentication and authorization

### 4. Queue System & Subscriber Strategies

Aiki supports multiple queue systems and subscriber strategies, allowing you to choose the right approach for your performance and reliability requirements.

#### Subscriber Strategy Architecture

Workers use pluggable subscriber strategies to fetch work from the queue system:

```
┌────────────────────────────────────────────────────────────┐
│                    Worker Process                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │            Subscriber Strategy                       │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐ │  │
│  │  │   Simple    │ │  Adaptive   │ │ Redis Streams   │ │  │
│  │  │   Polling   │ │   Polling   │ │ (Recommended)   │ │  │
│  │  └─────────────┘ └─────────────┘ └─────────────────┘ │  │
│  └──────────────────────────────────────────────────────┘  │
│                           │                                │
└───────────────────────────┼────────────────────────────────┘
                            │
                            ▼
            ┌─────────────────────────────────┐
            │        Queue Backend            │
            │   (Database, Redis, etc.)       │
            └─────────────────────────────────┘
```

#### Strategy Types

**1. Simple Polling Strategy**
- Basic polling with fixed intervals
- Suitable for development and low-volume scenarios
- Uses repository-based polling with configurable intervals

**2. Adaptive Polling Strategy**
- Intelligent polling that adapts to workload
- Backs off exponentially when no work is found
- Speeds up when work is consistently available
- Includes jitter to prevent thundering herd problems

**3. Redis Streams Strategy (Recommended for Production)**
- High-performance Redis Streams integration
- Built-in fault tolerance with message claiming
- Parallel processing across multiple streams
- Round-robin distribution for fair work allocation

#### Fault Tolerance Features (Redis Streams)

**Message Claiming:**
- Uses Redis XPENDING to find stuck messages
- XCLAIM operations to steal messages from failed workers
- Server-side idle time filtering for efficiency
- Automatic retry of claimed messages

**Parallel Operations:**
- Multiple Redis streams processed simultaneously
- XREADGROUP operations run in parallel
- XCLAIM operations execute concurrently
- Optimized for maximum throughput

**Fair Distribution:**
- Stream shuffling ensures fairness over time
- Round-robin batch size distribution
- Prevents any single stream from being overwhelmed

**Queue Features:**
- **Reliable Delivery**: Messages are persisted and survive server restarts
- **Load Balancing**: Distributes work across multiple workers
- **Retry Logic**: Handles failed deliveries with exponential backoff
- **Message Ordering**: Maintains order for related workflow runs
- **Dead Letter Handling**: Acknowledges malformed messages to prevent infinite loops

### 5. Workers

Workers execute workflows in your own environment and infrastructure with enhanced architecture for reliability and performance.

#### Enhanced Worker Architecture

**Subscriber Strategy Integration:**
- Workers use pluggable subscriber strategies for maximum flexibility
- Strategy selection based on performance and reliability requirements
- Support for both polling and streaming approaches

**Advanced Polling Mechanisms:**
- Adaptive polling that scales with workload
- Parallel stream processing for Redis Streams
- Intelligent backoff and jitter algorithms
- Round-robin work distribution

**Sharding Support:**
- Workers can be assigned to specific shards
- Enables horizontal scaling with predictable work distribution
- Supports geographic distribution and compliance requirements

**Execution Engine:**
- Loads workflow definitions from registry
- Executes tasks in sequence with enhanced error handling
- Discriminated union error patterns for better debugging
- Reports progress back to server with detailed status

**Enhanced State Management:**
- Maintains local execution state with recovery capabilities
- Handles worker restarts and graceful shutdown
- Provides heartbeat monitoring with timeout detection
- Capacity management for optimal resource utilization

**Fault Recovery:**
- Message claiming from failed workers (Redis Streams)
- Automatic redistribution of stuck workflows
- Dead worker detection and cleanup
- Graceful handling of network partitions

#### Worker Benefits

**Security:**
- Your business logic never leaves your environment
- Sensitive data stays within your infrastructure
- Compliance with data residency requirements

**Integration:**
- Direct access to your databases and APIs
- No network latency for external calls
- Full control over execution environment

**Scalability:**
- Deploy workers on any infrastructure
- Scale horizontally based on demand
- Geographic distribution for global applications

### 6. Redis Streams Integration

Aiki's Redis Streams integration provides high-performance, fault-tolerant message distribution with advanced reliability features.

#### Redis Streams Architecture

**Stream Organization:**
- One stream per workflow type: `workflow:${workflowName}`
- Sharded streams for horizontal scaling: `workflow:${workflowName}:${shard}`
- Consumer groups for distributed processing
- Message claiming for fault tolerance

**Message Flow:**
```
Server → Redis Stream → Consumer Group → Worker
   ↓         ↑              ↓            ↓
Storage   XPENDING      XREADGROUP    Process
          XCLAIM        (parallel)    Workflow
```

**Key Operations:**

**XREADGROUP (Message Retrieval):**
- Parallel reads across multiple streams
- Round-robin batch size distribution
- Blocking reads with configurable timeout
- Automatic fair distribution across workers

**XPENDING (Stuck Message Detection):**
- Server-side idle time filtering
- Parallel queries across streams
- Identifies messages stuck with failed workers
- Efficient dead worker detection

**XCLAIM (Message Recovery):**
- Parallel claiming operations for performance
- Steals messages from unresponsive workers
- Automatic retry of claimed messages
- Maintains message processing guarantees

#### Fault Tolerance Mechanisms

**Dead Worker Detection:**
- Configurable idle time thresholds (e.g., 60 seconds)
- Automatic identification of stuck messages
- Parallel scanning across all streams

**Message Recovery:**
- Reactive claiming (only when worker has capacity)
- Round-robin claiming distribution
- Preserves message ordering where possible
- Automatic acknowledgment of malformed messages

**Performance Optimizations:**
- Parallel Redis operations using Promise.allSettled
- Stream shuffling for fair access over time
- Intelligent batch size distribution
- Minimal Redis round trips

#### Configuration Options

**Reliability Settings:**
- `claimMinIdleTimeMs`: Time before claiming stuck messages
- `blockTimeMs`: How long to wait for new messages
- `maxRetryIntervalMs`: Maximum backoff for Redis failures

**Performance Settings:**
- Parallel stream processing
- Configurable batch sizes
- Adaptive polling intervals
- Connection pooling

### 7. Storage Layer

The storage layer provides durability and persistence for workflow state.

#### Storage Requirements

**Data Types:**
- Workflow definitions and versions
- Workflow run state and metadata
- Task execution results and history
- Queue messages and delivery status
- Audit logs and monitoring data

**Performance Requirements:**
- Low latency for workflow operations
- High throughput for concurrent executions
- Reliable persistence for durability
- Scalable storage for growth

#### Storage Options

**Database Storage:**
- PostgreSQL, MySQL, or other relational databases
- ACID compliance for data consistency
- Transaction support for complex operations
- Built-in backup and recovery

**Distributed Storage:**
- Redis for caching and session state
- S3-compatible storage for large objects
- Event stores for audit trails
- Time-series databases for metrics

## Data Flow

### 1. Workflow Enqueueing

```
Application → SDK Client → Aiki Server → Storage
                                    ↓
                                 Queue System
```

1. Application calls `workflow.enqueue()`
2. SDK client sends request to Aiki Server
3. Server validates workflow and creates workflow run
4. Server stores workflow run in storage
5. Server publishes message to queue
6. Server returns result handle to client

### 2. Workflow Execution

```
Queue System → Worker → Task Execution → Result Reporting
                                    ↓
                                 Aiki Server
```

1. Worker polls queue for available workflow runs
2. Worker receives workflow run and loads definition
3. Worker executes tasks in sequence
4. Worker reports task results to server
5. Server updates workflow state in storage
6. Server publishes next task or completion

### 3. State Synchronization

```
Worker ←→ Aiki Server ←→ Storage
   ↓
Queue System
```

1. Worker sends heartbeat to server
2. Server updates worker status in storage
3. Server publishes workflow updates to queue
4. Other workers receive updates if needed

## Design Principles

### 1. Separation of Concerns

- **Orchestration**: Handled by Aiki Server
- **Execution**: Handled by Workers in your environment
- **State Management**: Centralized in storage
- **Communication**: Through reliable queue system

### 2. Event-Driven Architecture

- Components communicate through events
- Loose coupling between server and workers
- Scalable message distribution
- Reliable event delivery

### 3. Fault Tolerance

- State persistence ensures durability
- Automatic retry mechanisms
- Graceful degradation
- Circuit breaker patterns

### 4. Security by Design

- Execution in your environment
- No code execution in Aiki infrastructure
- Secure communication protocols
- Data encryption in transit and at rest

## Deployment Models

### 1. Self-Hosted

Deploy Aiki Server and queue system in your own infrastructure:

**Benefits:**
- Full control over deployment
- Custom security policies
- Integration with existing infrastructure
- No vendor lock-in

**Components:**
- Aiki Server (container or VM)
- Queue system (Redis, RabbitMQ, etc.)
- Storage (PostgreSQL, MySQL, etc.)
- Load balancer and monitoring

### 2. Cloud-Based

Use Aiki's managed service for orchestration:

**Benefits:**
- Managed infrastructure
- Automatic scaling
- Built-in monitoring
- Reduced operational overhead

**Components:**
- Your workers (in your cloud account)
- Aiki's managed server and queue
- Your storage or Aiki's managed storage

### 3. Hybrid

Mix of self-hosted and cloud components:

**Benefits:**
- Flexibility in deployment
- Cost optimization
- Compliance requirements
- Geographic distribution

## Scalability Considerations

### 1. Horizontal Scaling

- **Workers**: Add more workers to increase throughput
- **Server**: Scale server instances for high availability
- **Queue**: Use distributed queue systems
- **Storage**: Implement read replicas and sharding

### 2. Performance Optimization

- **Caching**: Cache frequently accessed data
- **Connection Pooling**: Reuse database connections
- **Batch Processing**: Process multiple items together
- **Async Processing**: Non-blocking operations

### 3. Monitoring and Observability

- **Metrics**: Track execution times and throughput
- **Logging**: Comprehensive audit trails
- **Tracing**: Distributed tracing for debugging
- **Alerting**: Proactive issue detection

## Security Considerations

### 1. Network Security

- **TLS Encryption**: All communication encrypted
- **Authentication**: Secure API access
- **Authorization**: Role-based access control
- **Network Isolation**: VPC and firewall rules

### 2. Data Security

- **Encryption at Rest**: Encrypt stored data
- **Encryption in Transit**: Encrypt network traffic
- **Data Residency**: Control data location
- **Access Logging**: Audit data access

### 3. Execution Security

- **Code Isolation**: Workers run in isolated environments
- **Resource Limits**: Prevent resource exhaustion
- **Sandboxing**: Limit system access
- **Vulnerability Scanning**: Regular security updates 