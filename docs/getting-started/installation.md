# Installation

This guide covers two ways to run Aiki:

- **Option A: Docker Compose** — Runs Aiki server and web UI in containers
- **Option B: Direct with Bun** — Runs Aiki directly on your machine

Both options require PostgreSQL and Redis running externally.

---

## Option A: Using Docker Compose

### Prerequisites

- Docker and Docker Compose
- PostgreSQL 14+
- Redis 6.2+

### Step 1: Clone the Repository

```bash
git clone https://github.com/aikirun/aiki.git
cd aiki
```

### Step 2: Configure Environment

Create a `.env` file in the repository root with your PostgreSQL and Redis connection details:

```bash
# .env
DATABASE_URL=postgresql://user:password@host.docker.internal:5432/aiki
REDIS_HOST=host.docker.internal
REDIS_PORT=6379
REDIS_PASSWORD=
```

Replace with your actual credentials. Use `host.docker.internal` to connect to services running on your host machine.

### Step 3: Start Aiki

```bash
docker-compose up
```

This starts:
- **Aiki Server** on http://localhost:9850
- **Aiki Web UI** on http://localhost:9851

### Step 4: Install SDK Packages

In a separate terminal, navigate to your own application project (not the aiki directory) and install the SDK:

```bash
npm install @aikirun/client @aikirun/worker @aikirun/workflow @aikirun/task
# or: bun add, pnpm add, yarn add
```

You're ready! Continue to the [Quick Start](./quick-start.md) guide.

---

## Option B: Running Directly with Bun

### Prerequisites

- Bun 1.0+
- PostgreSQL 14+
- Redis 6.2+

### Step 1: Clone the Repository

```bash
git clone https://github.com/aikirun/aiki.git
cd aiki
bun install
```

### Step 2: Configure Environment

```bash
cp server/.env.example server/.env
```

Edit `server/.env` with your PostgreSQL and Redis connection details.

### Step 3: Start Aiki

```bash
# Terminal 1 - Start the server
bun run server

# Terminal 2 - Start the web UI
bun run web
```

This starts:
- **Aiki Server** on http://localhost:9850
- **Aiki Web UI** on http://localhost:9851

### Step 4: Install SDK Packages

In a separate terminal, navigate to your own application project (not the aiki directory) and install the SDK:

```bash
npm install @aikirun/client @aikirun/worker @aikirun/workflow @aikirun/task
# or: bun add, pnpm add, yarn add
```

You're ready! Continue to the [Quick Start](./quick-start.md) guide.

---

## Environment Variable Reference

### Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_PROVIDER` | Yes | - | Database type: `pg`, `mysql`, or `sqlite` |
| `DATABASE_URL` | Yes | - | Connection string (e.g., `postgresql://user:password@host:port/database`) |
| `DATABASE_MAX_CONNECTIONS` | No | `10` | Maximum database connections in pool |
| `DATABASE_SSL` | No | `false` | Enable SSL for database connection |
| `AIKI_SERVER_PORT` | No | `9850` | Port for the Aiki server |
| `AIKI_SERVER_BASE_URL` | Yes | - | Public URL of the Aiki server |
| `AIKI_SERVER_AUTH_SECRET` | Yes | - | Secret key for authentication |
| `CORS_ORIGINS` | No | - | Comma-separated list of allowed origins |
| `REDIS_HOST` | Yes | - | Redis server hostname |
| `REDIS_PORT` | No | `6379` | Redis server port |
| `REDIS_PASSWORD` | No | - | Redis password (if required) |

### Web UI

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_AIKI_SERVER_URL` | No | `http://localhost:9850` | Server URL for the web UI to connect to |
| `AIKI_WEB_PORT` | No | `9851` | Port for the web UI |

Note: `VITE_AIKI_SERVER_URL` is a build-time variable. If you change it, you need to rebuild the web image.

---

## Next Steps

- [Quick Start](./quick-start.md) — Create your first workflow
- [Your First Workflow](./first-workflow.md) — Learn core concepts with a real example
