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
                                      │ Message Queue
                                      ▼
                     ┌───────────────────────────────────┐
                     │          Message Queue            │
                     │  ┌─────────────────────────────┐  │
                     │  │  Stream: workflow:orders    │  │
                     │  │  Stream: workflow:users     │  │
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

Your application uses the Aiki SDK to define workflows and tasks, start workflow runs, monitor execution status, and
retrieve results.

### 2. Aiki Server

The Aiki Server orchestrates workflows and manages state through three key functions: workflow orchestration manages the
workflow lifecycle, task management tracks task execution, and the storage layer persists state and history.

### 3. Message Queue

The message queue provides high-performance message distribution using consumer groups for work distribution, message
claiming for fault tolerance, and automatic load balancing (workers pull work when they have capacity).

**Available implementations**: Redis Streams (default). See [Redis Streams](./redis-streams.md) for details.

### 4. Workers

Workers execute workflows in your infrastructure by receiving workflow runs from the message queue, executing workflow
logic and tasks, reporting results to the server, and handling retries and failures.

## Data Flow

### 1. Starting a Workflow

```
Application → SDK Client → Aiki Server → Storage
                                    ↓
                               Message Queue
```

1. Application calls `workflowVersion.start()`
2. SDK client sends request to server
3. Server validates and creates workflow run
4. Server stores run in database
5. Server publishes message to message queue
6. Returns result handle to client

### 2. Workflow Execution

```
Message Queue → Worker → Task Execution → Server
```

1. Worker receives workflow run message from queue
2. Worker loads workflow definition
3. Worker executes workflow logic and tasks
4. Worker reports results to server
5. Server updates state in storage

### 3. State Updates

```
Worker → Server → Storage → Subscribers
```

1. Worker updates workflow run state via server
2. Server persists state to storage
3. Server streams updates to subscribers (SSE for browsers, pub-sub for backend services)

## Next Steps

- **[Server](./server.md)** - Server component details
- **[Workers](./workers.md)** - Worker architecture deep dive
- **[Redis Streams](./redis-streams.md)** - Message distribution specifics
