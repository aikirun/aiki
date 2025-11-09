# Installation

Get Aiki up and running in your project with these simple steps.

## Prerequisites

- **Docker & Docker Compose** (recommended for local development)
  - See [Docker Setup Guide](../DOCKER_SETUP.md) to get started
- **Runtime**: Node.js 18+ or Deno 1.30+ (for your application code)
- **Redis**: 6.2+ (included in Docker Compose setup)

## Install SDK Packages

### Using npm

```bash
npm install @aikirun/client @aikirun/worker @aikirun/workflow @aikirun/task
```

### Using Deno

```typescript
import { client } from "jsr:@aikirun/client@^0.1.0";
import { worker } from "jsr:@aikirun/worker@^0.1.0";
import { workflow } from "jsr:@aikirun/workflow@^0.1.0";
import { task } from "jsr:@aikirun/task@^0.1.0";
```

## Set Up Infrastructure

The easiest way to get started is with Docker Compose, which sets up both Redis and the Aiki server:

```bash
docker-compose up
```

This starts:
- **Aiki Server** on `http://localhost:9090`
- **Redis** on `localhost:6379`

For more details, see the [Docker Setup Guide](../DOCKER_SETUP.md).

### Configuration

You can customize the ports using environment variables:

```bash
# Use different Aiki server port
AIKI_PORT=8080 docker-compose up

# Use different Redis port
REDIS_PORT=7379 docker-compose up

# Use both
AIKI_PORT=8080 REDIS_PORT=7379 docker-compose up
```

Or create a `.env` file (see `.env.example`) to persist your configuration.

## Verify Installation

Create a simple test file to verify your setup:

```typescript
import { client } from "@aikirun/client";

const aiki = await client({
	url: "localhost:9090",
	redis: {
		host: "localhost",
		port: 6379,
	},
});

console.log("✅ Aiki client connected successfully!");

await aiki.close();
```

Run it:

```bash
node test.js  # or deno run --allow-net test.ts
```

## Next Steps

- **[Quick Start](./quick-start.md)** - Build your first workflow
- **[Your First Workflow](./first-workflow.md)** - Step-by-step tutorial
