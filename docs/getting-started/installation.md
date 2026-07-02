# Installation

Aiki's server is a library: you install the SDK packages into your project, apply the schema migration to your database, and choose where the server runs — in the same process as your app, in a process of its own, or as the bundled standalone server with a web dashboard.

The install and migration steps are the same for every topology.

## Prerequisites

- Node.js 18+ or Bun 1.0+
- PostgreSQL 14+ (SQLite and MySQL coming soon)

## Install the SDK packages

```bash
npm install @aikirun/workflow @aikirun/client @aikirun/worker @aikirun/server
npm install --save-dev @aikirun/cli
```

## Apply the schema migration

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/aiki \
  npx aiki migrate apply --package server
```

Re-run this command when upgrading Aiki to apply new migrations.

## Choose where the server runs

Both shapes below run the same server, and workflow code is identical either way.

### Embedded in your process

Mount `aikiServer.handler` in any HTTP framework — in the same process as your app, or in a process dedicated to Aiki. The [Quick Start](./quick-start.md) walks through this end-to-end, including worker and client.

### Bundled standalone server + dashboard

The repo ships a prebuilt server (`app/server`) and a web dashboard (`app/dashboard`), bundled in `docker-compose.yml`.

#### Run with Docker Compose

```bash
git clone https://github.com/aikirun/aiki.git
cd aiki
```

Create a `.env` in the repo root with your database URL:

```bash
DATABASE_URL=postgresql://user:password@your-db-host:5432/aiki
```

```bash
docker-compose up -d
```

- Server: http://localhost:9850
- Dashboard: http://localhost:9851

Point the client at the server's URL:

```typescript
const aikiClient = client({ url: "http://localhost:9850" });
```

#### Run with Bun (no Docker)

```bash
git clone https://github.com/aikirun/aiki.git
cd aiki
bun install
cp app/server/.env.example app/server/.env
# Edit app/server/.env with your DATABASE_URL

bun run server     # Terminal 1
bun run dashboard  # Terminal 2
```

## Environment Variable Reference

These apply to the bundled `app/server` and `app/dashboard`. If you embed the server in your own app, you control configuration directly via the `server({...})` factory and don't need these.

### Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_PROVIDER` | No | `pg` | Database provider; `pg` is supported today, `sqlite` and `mysql` coming soon |
| `DATABASE_URL` | Yes | — | Postgres connection string |
| `DATABASE_MAX_CONNECTIONS` | No | `10` | Connection pool size |
| `DATABASE_SSL` | No | `false` | Enable SSL for Postgres |
| `AIKI_SERVER_HOST` | No | `0.0.0.0` | Bind address |
| `AIKI_SERVER_PORT` | No | `9850` | Server port |
| `AIKI_SERVER_BASE_URL` | If IAM is on | — | Public URL of the server; required only when `AIKI_SERVER_AUTH_SECRET` is also set |
| `AIKI_SERVER_AUTH_SECRET` | If IAM is on | — | Authentication secret; setting this (with `AIKI_SERVER_BASE_URL`) activates the IAM package |
| `CORS_ORIGINS` | No | — | Comma-separated allowed origins for cross-origin requests |
| `REDIS_HOST` | No | — | Enables Redis-backed work distribution and timer dispatch |
| `REDIS_PORT` | No | `6379` | Redis port |
| `REDIS_PASSWORD` | No | — | Redis password |
| `LOG_LEVEL` | No | `info` | Log level |
| `PRETTY_LOGS` | No | `true` | Pretty-print logs (set `false` for JSON output) |

### Dashboard

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AIKI_SERVER_UPSTREAM_URL` | If using the docker image | — | Server address the dashboard docker image proxies to; read at container start |
| `AIKI_DASHBOARD_PORT` | No | `9851` | Port for the dashboard |
| `VITE_AIKI_SERVER_URL` | If on a static host | — | Build-time server URL for a dashboard served outside the docker image (see below) |

The dashboard runs in one of two modes:

- **Dashboard docker image.** nginx inside the image serves the dashboard and forwards its server calls to the address in `AIKI_SERVER_UPSTREAM_URL`, read when the container starts. The bundled `docker-compose.yml` sets it for you; set it yourself when running the image directly. No build-time configuration is needed.
- **Static host.** You build the dashboard and serve the files yourself, so the browser calls the server directly. Build with `VITE_AIKI_SERVER_URL` set to the server's URL, and add the dashboard's origin to the server's `CORS_ORIGINS`.

---

## Next Steps

- [Quick Start](./quick-start.md) — Create your first workflow
- **[Your First Workflow](./first-workflow.md)** — A multi-step workflow with events, child workflows, and durable sleep
