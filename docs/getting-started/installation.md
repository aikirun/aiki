# Installation

Get Aiki up and running in 5 minutes with these simple steps.

## Step 1: Check Prerequisites

Before you begin, make sure you have the required tools installed:

```bash
# Check Docker and Docker Compose
docker --version
docker-compose --version

# Check Node.js (v18+) or Deno (v1.30+)
node --version      # or: deno --version
```

If any of these are missing:

- **Docker**: https://docs.docker.com/get-docker/
- **Node.js**: https://nodejs.org/en/
- **Deno**: https://docs.deno.com/runtime/manual/getting_started/installation/

## Step 2: Start the Aiki Server and Redis

Clone the Aiki repository and start the infrastructure:

```bash
# From the Aiki repository root
docker-compose up
```

This starts:

- **Aiki Server** on `http://localhost:9090`
- **Redis** on `localhost:6379`

You'll see output like:

```
aiki-server | Server running on 0.0.0.0:9090
redis | Ready to accept connections
```

Leave this running in one terminal and continue in another.

### Customizing Ports (Optional)

If you need different ports, use environment variables:

```bash
# Use different ports
AIKI_PORT=8080 REDIS_PORT=7379 docker-compose up
```

Or create a `.env` file at the repository root. See `server/.env.example` for available configuration options.

## Step 3: Install SDK Packages

In a new terminal, install the Aiki packages for your project:

### Using npm

```bash
npm install @aikirun/client @aikirun/worker @aikirun/workflow @aikirun/task
```

### Using Deno

Add imports directly in your code (no installation needed):

```typescript
import { client } from "jsr:@aikirun/client@^0.1.0";
import { worker } from "jsr:@aikirun/worker@^0.1.0";
import { workflow } from "jsr:@aikirun/workflow@^0.1.0";
import { task } from "jsr:@aikirun/task@^0.1.0";
```

## Step 4: You're Ready!

Your Aiki infrastructure is now running and you have the SDK packages installed. Proceed to the
[Quick Start](./quick-start.md) guide to create your first workflow.

## Troubleshooting

**"Connection refused" error**

- Make sure `docker-compose up` is running in another terminal
- Verify the server is listening: check the Docker output for "Server running on 0.0.0.0:9090"

**"Cannot find module" error (npm)**

- Run `npm install` first to ensure all packages are installed
- Check that you're in the correct project directory

**"Permission denied" error (Docker)**

- Try running Docker commands with `sudo` if needed
- Or add your user to the docker group (consult Docker documentation)

**Port already in use**

- Use different ports: `AIKI_PORT=8080 docker-compose up`
- Or stop other services using those ports

## Next Steps

- **[Quick Start](./quick-start.md)** - Create your first workflow in 5 minutes
- **[Your First Workflow](./first-workflow.md)** - Learn core concepts with a real example
