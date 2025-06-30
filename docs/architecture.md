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
                      │ Queue System
                      │ (Message Distribution)
                      ▼
          ┌─────────────────────────────────────────────────────────┐
          │                                                         │
          │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
          │  │   Worker A  │  │   Worker B  │  │   Worker C  │     │
          │  │             │  │             │  │             │     │
          │  │ Executes    │  │ Executes    │  │ Executes    │     │
          │  │ Workflows   │  │ Workflows   │  │ Workflows   │     │
          │  │ in YOUR     │  │ in YOUR     │  │ in YOUR     │     │
          │  │ Environment │  │ Environment │  │ Environment │     │
          │  └─────────────┘  └─────────────┘  └─────────────┘     │
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

### 4. Queue System

The queue system ensures reliable message delivery between the server and workers.

**Features:**
- **Reliable Delivery**: Messages are persisted and survive server restarts
- **Load Balancing**: Distributes work across multiple workers
- **Retry Logic**: Handles failed deliveries with exponential backoff
- **Message Ordering**: Maintains order for related workflow runs
- **Dead Letter Queues**: Handles messages that can't be processed

**Queue Types:**
- **Workflow Queue**: New workflow runs to be executed
- **Task Queue**: Individual tasks within workflows
- **Result Queue**: Task results back to the server
- **Dead Letter Queue**: Failed messages for investigation

### 5. Workers

Workers execute workflows in your own environment and infrastructure.

#### Worker Architecture

**Polling Mechanism:**
- Workers poll the queue for available workflow runs
- Configurable polling intervals and batch sizes
- Exponential backoff for empty queues

**Execution Engine:**
- Loads workflow definitions from registry
- Executes tasks in sequence
- Handles task failures and retries
- Reports progress back to server

**State Management:**
- Maintains local execution state
- Handles worker restarts and recovery
- Provides heartbeat monitoring

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

### 6. Storage Layer

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