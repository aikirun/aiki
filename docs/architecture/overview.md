# Architecture Overview

Aiki separates workflow orchestration from execution: a server orchestrates, workers and endpoints execute. The separation is architectural, not physical — the server is a library, so the components can share a single process or be deployed independently. Workflow code is identical either way.

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
└──────────────────────┬──────────────────────────────────┬─────────────────┘
                       │                                  │
                       │ Pull (Subscribers)                │ Push (HTTP)
                       ▼                                  ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────────┐
│  ┌──────────┐ ┌──────────┐ ┌──────┐ │  │  ┌──────────────────────────┐    │
│  │ Worker A │ │ Worker B │ │ ...  │ │  │  │  Endpoint Handler        │    │
│  │          │ │          │ │      │ │  │  │  (Serverless Function)    │    │
│  │ Long-    │ │ Long-    │ │      │ │  │  │                          │    │
│  │ lived    │ │ lived    │ │      │ │  │  │  Executes workflows      │    │
│  │ process  │ │ process  │ │      │ │  │  │  per request             │    │
│  └──────────┘ └──────────┘ └──────┘ │  │  └──────────────────────────┘    │
│                                      │  │                                  │
│         Your Infrastructure          │  │     Serverless Platform          │
└──────────────────────────────────────┘  └──────────────────────────────────┘
```

## Key Components

### 1. Your Application

Your application uses the Aiki SDK to define workflows and tasks, start workflow runs, monitor execution status, and
retrieve results.

### 2. Aiki Server

The Aiki Server orchestrates workflows and manages state through three key functions: workflow orchestration manages the
workflow lifecycle, task management tracks task execution, and the storage layer persists state and history.

The server ships as a library — `server({ db })` returns an HTTP handler and a background runtime — so it runs embedded in your process or as a standalone service. See [Server](./server.md).

### 3. Work Delivery

Aiki supports two models for delivering workflow runs to your code:

- **Pull (Workers)** - Long-lived processes that discover ready work through pluggable [subscribers](./subscribers.md) — claiming from the server's API by default, or receiving from Redis queues. Scale by running multiple instances.

- **Push (Endpoints)** - The server pushes workflow runs via HTTP to a request handler you expose. Designed for serverless platforms (Cloudflare Workers, AWS Lambda, Vercel) where long-lived polling isn't possible.

A workflow behaves identically whether executed by a worker or an endpoint.

### 4. Workers

Workers execute workflows in your infrastructure by receiving workflow runs from their subscriber, executing workflow
logic and tasks, reporting results to the server, and handling retries and failures.

### 5. Endpoints

Endpoints execute workflows in serverless environments. The server sends a signed HTTP request containing the workflow run ID. The endpoint handler verifies the signature, fetches the workflow run state, and executes it exactly as a worker would.

## Data Flow

### 1. Starting a Workflow

```
Application → SDK Client → Aiki Server → Storage
```

1. Application calls `workflowVersion.start()`
2. SDK client sends request to server
3. Server validates and creates workflow run
4. Server stores run in database
5. Server makes run available for delivery (via subscribers for workers, or HTTP push for endpoints)
6. Returns result handle to client

### 2. Workflow Execution (Pull)

```
Subscriber → Worker → Task Execution → Server
```

1. Worker discovers workflow run through its subscriber
2. Worker loads workflow definition
3. Worker executes workflow logic and tasks
4. Worker reports results to server
5. Server updates state in storage

### 3. Workflow Execution (Push)

```
Aiki Server → HTTP → Endpoint → Task Execution → Server
```

1. Server sends signed HTTP request to endpoint with workflow run ID
2. Endpoint verifies signature, fetches workflow run state
3. Endpoint executes workflow logic and tasks
4. Endpoint reports results to server
5. Server updates state in storage

### 4. State Updates

```
Worker/Endpoint → Server → Storage
```

1. Worker or endpoint updates workflow run state via server
2. Server persists state to storage
3. Clients observe progress through run handles (e.g. `handle.waitForStatus`)

## Next Steps

- **[Server](./server.md)** - Server component details
- **[Workers](../core-concepts/workers.md)** - Worker configuration and execution
- **[Subscribers](./subscribers.md)** - Work discovery implementations
