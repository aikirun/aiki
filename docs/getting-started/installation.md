# Installation

This guide will help you set up Aiki in your project.

## Prerequisites

- **Runtime**: Node.js 18+ or Deno 1.30+
- **Redis**: 6.2+ (for Redis Streams)
- **Database**: PostgreSQL 14+ (for the Aiki server)

## Install SDK Packages

### Using npm

```bash
npm install @aiki/client @aiki/worker @aiki/workflow @aiki/task
```

### Using Deno

```typescript
import { client } from "jsr:@aiki/client@^0.1.0";
import { worker } from "jsr:@aiki/worker@^0.1.0";
import { workflow } from "jsr:@aiki/workflow@^0.1.0";
import { task } from "jsr:@aiki/task@^0.1.0";
```

## Set Up Infrastructure

### Redis

Aiki requires Redis 6.2+ for message distribution.

**Using Docker:**

```bash
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

**Using Homebrew (macOS):**

```bash
brew install redis
brew services start redis
```

### Aiki Server

The Aiki server handles workflow orchestration and state management.

**Using Docker:**

```bash
docker run -d \
  --name aiki-server \
  -p 9090:9090 \
  -e DATABASE_URL=postgresql://user:pass@localhost/aiki \
  -e REDIS_URL=redis://localhost:6379 \
  aiki/server:latest
```

**Environment Variables:**

- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `PORT`: Server port (default: 9090)

## Verify Installation

Create a simple test file to verify your setup:

```typescript
import { client } from "@aiki/client";

const aikiClient = await client({
  url: "localhost:9090",
  redis: {
    host: "localhost",
    port: 6379
  }
});

console.log("✅ Aiki client connected successfully!");

await aikiClient.close();
```

Run it:

```bash
node test.js  # or deno run --allow-net test.ts
```

## Next Steps

- **[Quick Start](./quick-start.md)** - Build your first workflow
- **[Your First Workflow](./first-workflow.md)** - Step-by-step tutorial
