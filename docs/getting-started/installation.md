# Installation

This guide covers three ways to run Aiki:

- **Option A: SQLite (simplest)** — No external database needed, runs entirely on your machine
- **Option B: Docker Compose** — Runs Aiki server and web UI in containers with PostgreSQL
- **Option C: Direct with Bun + PostgreSQL** — Runs Aiki directly on your machine with PostgreSQL

Redis is optional for all options — it enables lower-latency message delivery but Aiki works without it.

---

## Option A: SQLite (Simplest)

The fastest way to get started — no PostgreSQL or Docker required. SQLite is ideal for development, testing, and single-node production deployments.

### Prerequisites

- Bun 1.0+

### Step 1: Clone and Install

```bash
git clone https://github.com/aikirun/aiki.git
cd aiki
bun install
```

### Step 2: Configure Environment

```bash
cp server/.env.example server/.env
```

Edit `server/.env` to use SQLite:

```bash
DATABASE_PROVIDER=sqlite
DATABASE_PATH=./data/aiki.db
```

Comment out or remove the `DATABASE_URL` line — it's not needed for SQLite.

### Step 3: Push the Database Schema

```bash
cd server
bunx drizzle-kit push --config infra/db/drizzle.config.ts
cd ..
```

This creates the SQLite database file and all required tables.

### Step 4: Start Aiki

```bash
# Terminal 1 - Start the server
bun run server

# Terminal 2 - Start the web UI
bun run web
```

This starts:
- **Aiki Server** on http://localhost:9850
- **Aiki Web UI** on http://localhost:9851

### Step 5: Install SDK Packages

In a separate terminal, navigate to your own application project (not the aiki directory) and install the SDK:

```bash
npm install @aikirun/client @aikirun/worker @aikirun/workflow @aikirun/task
# or: bun add, pnpm add, yarn add
```

You're ready! Continue to the [Quick Start](./quick-start.md) guide.

> **Note:** SQLite uses a single database file and supports one writer at a time. This is fine for development and single-server production, but for multi-server deployments use PostgreSQL instead.

---

## Option B: Using Docker Compose

### Prerequisites

- Docker and Docker Compose
- PostgreSQL 14+
- Redis 6.2+ (optional, for lower-latency message delivery)

### Step 1: Clone the Repository

```bash
git clone https://github.com/aikirun/aiki.git
cd aiki
```

### Step 2: Configure Environment

Create a `.env` file in the repository root with your connection details:

```bash
# .env
DATABASE_URL=postgresql://user:password@host.docker.internal:5432/aiki

# Optional: Redis for lower-latency message delivery
# REDIS_HOST=host.docker.internal
# REDIS_PORT=6379
# REDIS_PASSWORD=
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
npm install @aikirun/client @aikirun/worker @aikirun/workflow
# or: bun add, pnpm add, yarn add
```

You're ready! Continue to the [Quick Start](./quick-start.md) guide.

---

## Option C: Running Directly with Bun + PostgreSQL

### Prerequisites

- Bun 1.0+
- PostgreSQL 14+
- Redis 6.2+ (optional, for lower-latency message delivery)

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

Edit `server/.env` with your PostgreSQL connection details (and optionally Redis).

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
npm install @aikirun/client @aikirun/worker @aikirun/workflow
# or: bun add, pnpm add, yarn add
```

You're ready! Continue to the [Quick Start](./quick-start.md) guide.

---

## Environment Variable Reference

### Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_PROVIDER` | No | `pg` | Database type: `pg` (PostgreSQL) or `sqlite` |
| `DATABASE_URL` | Yes (pg) | - | PostgreSQL connection string (e.g., `postgresql://user:password@host:port/database`) |
| `DATABASE_PATH` | No (sqlite) | `:memory:` | Path to SQLite database file (e.g., `./data/aiki.db`) |
| `DATABASE_MAX_CONNECTIONS` | No | `10` | Maximum database connections in pool (PostgreSQL only) |
| `DATABASE_SSL` | No | `false` | Enable SSL for database connection (PostgreSQL only) |
| `AIKI_SERVER_HOST` | No | `0.0.0.0` | Host address to bind the server to |
| `AIKI_SERVER_PORT` | No | `9850` | Port for the Aiki server |
| `AIKI_SERVER_BASE_URL` | Yes | - | Public URL of the Aiki server |
| `AIKI_SERVER_AUTH_SECRET` | Yes | - | Secret key for authentication |
| `CORS_ORIGINS` | No | - | Comma-separated list of allowed origins |
| `REDIS_HOST` | No | - | Redis server hostname (enables Redis-based message delivery) |
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
