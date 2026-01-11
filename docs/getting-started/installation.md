# Installation

Get Aiki up and running with these simple steps.

## Step 1: Check Prerequisites

Before you begin, make sure you have the required tools installed:

```bash
# Check Docker and Docker Compose
docker --version
docker-compose --version

# Check Node.js (v18+) or Bun (v1.0+)
node --version      # or: bun --version
```

If any of these are missing:

- **Docker**: https://docs.docker.com/get-docker/
- **Node.js**: https://nodejs.org/en/
- **Bun**: https://bun.sh/docs/installation

## Step 2: Start Redis

Aiki requires a Redis instance for message queue functionality. Start Redis locally:

```bash
# Using Docker
docker run -d --name redis -p 6379:6379 redis:7

# Or using your system's package manager
# macOS: brew install redis && brew services start redis
# Ubuntu: sudo apt install redis-server && sudo systemctl start redis
```

## Step 3: Start Aiki

### Option 1: Using Docker Compose

```bash
docker-compose up
```

This starts both services:
- **Aiki Server** on `http://localhost:9850`
- **Aiki Web** on `http://localhost:9851`

You'll see output like:

```
aiki-server | Server running on 0.0.0.0:9850
aiki-web    | ... nginx ready
```

### Option 2: Run directly with Bun

```bash
# In one terminal - start the server
bun run server

# In another terminal - start the web UI
bun run web
```

This starts:
- **Aiki Server** on `http://localhost:9850`
- **Aiki Web** on `http://localhost:9851`

---

Open `http://localhost:9851` in your browser to access the web UI and monitor your workflows.

Leave this running and continue in another terminal.

### Customizing Ports (Optional)

If you need different ports, use environment variables:

```bash
AIKI_SERVER_PORT=9000 AIKI_WEB_PORT=9001 docker-compose up
```

Or create a `.env` file at the repository root. See `server/.env.example` for available configuration options.

## Step 4: Install SDK Packages

In a new terminal, install the Aiki packages for your project:

```bash
npm install @aikirun/client @aikirun/worker @aikirun/workflow @aikirun/task
```

Or with other package managers:

```bash
# Using Bun
bun add @aikirun/client @aikirun/worker @aikirun/workflow @aikirun/task

# Using pnpm
pnpm add @aikirun/client @aikirun/worker @aikirun/workflow @aikirun/task

# Using yarn
yarn add @aikirun/client @aikirun/worker @aikirun/workflow @aikirun/task
```

## Step 5: You're Ready!

Your Aiki infrastructure is now running and you have the SDK packages installed. Proceed to the
[Quick Start](./quick-start.md) guide to create your first workflow.

## Troubleshooting

**"Connection refused" error**

- Make sure Redis is running (`docker ps` to check)
- Make sure `docker-compose up` is running in another terminal
- Verify the server is listening: check the Docker output for "Server running on 0.0.0.0:9850"

**"Cannot find module" error (npm)**

- Run `npm install` first to ensure all packages are installed
- Check that you're in the correct project directory

**"Permission denied" error (Docker)**

- Try running Docker commands with `sudo` if needed
- Or add your user to the docker group (consult Docker documentation)

**Port already in use**

- Use different ports: `AIKI_SERVER_PORT=9000 AIKI_WEB_PORT=9001 docker-compose up`
- Or stop other services using those ports

**Web UI shows "Loading..." or errors**

- Make sure the Aiki Server is running and accessible
- Check browser console for connection errors
- Verify `VITE_AIKI_SERVER_URL` points to the correct server URL if customized

## Next Steps

- **[Quick Start](./quick-start.md)** - Create your first workflow
- **[Your First Workflow](./first-workflow.md)** - Learn core concepts with a real example
