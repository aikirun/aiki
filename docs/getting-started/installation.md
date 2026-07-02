# Installation

How you install Aiki depends on what you're doing:

- **Building workflows** — add the SDK to your TypeScript project and run the server embedded in your app, or point your app at a hosted Aiki server. Follow [Add Aiki to your project](#add-aiki-to-your-project).
- **Hosting Aiki** — stand up the standalone server and web dashboard as infrastructure, with no SDK install. You need a PostgreSQL database, plus either Docker for the ready-made stack or Bun to run from source. Follow [Run the standalone server and dashboard](#run-the-standalone-server-and-dashboard).

## Add Aiki to your project

You need Node.js 18+ or Bun 1.0+, and a PostgreSQL 14+ database (SQLite and MySQL coming soon).

### Install the SDK packages

```bash
npm install @aikirun/workflow @aikirun/client @aikirun/worker @aikirun/server
npm install --save-dev @aikirun/cli
```

### Apply the schema migration

If your server will be the standalone stack from [Run the standalone server and dashboard](#run-the-standalone-server-and-dashboard), skip this step — that stack applies migrations itself when it starts.

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/aiki \
  npx aiki migrate apply --package server
```

Re-run this command when upgrading Aiki to apply new migrations.

### Run the server

Mount `aikiServer.handler` in any HTTP framework — in the same process as your app, or in a process dedicated to Aiki. The [Quick Start](./quick-start.md) walks through this end-to-end, including worker and client.

Workflow code is identical against an embedded or standalone server, so you can also skip embedding entirely and point your client at a server hosted per [Run the standalone server and dashboard](#run-the-standalone-server-and-dashboard).

## Run the standalone server and dashboard

The prebuilt server and dashboard ship as a ready-made stack, run from a clone of [aikirun/aiki](https://github.com/aikirun/aiki). With Docker, one command applies the migrations, starts the server, and serves the dashboard (a from-source variant without Docker follows below):

```bash
git clone https://github.com/aikirun/aiki.git
cd aiki
```

Create a `.env` in the clone's root with your database URL:

```bash
DATABASE_URL=postgresql://user:password@your-db-host:5432/aiki
```

```bash
docker-compose up -d
```

- Server: http://localhost:9850
- Dashboard: http://localhost:9851

Migrations are applied before the server starts. Re-running is safe; already-applied migrations are skipped.

Applications connect by pointing their client at the server's URL:

```typescript
const aikiClient = client({ url: "http://localhost:9850" });
```

Prefer no Docker? The same stack runs from source (this path needs Bun):

```bash
bun install
cp app/server/.env.example app/server/.env
# Edit app/server/.env with your DATABASE_URL

bun run server     # Terminal 1
bun run dashboard  # Terminal 2
```

## Run the dashboard on its own

If you ran the standalone stack above, the dashboard is already up — skip this section. Run the dashboard separately when your server is embedded in your app or hosted elsewhere. It is a single-page app that calls the server from the browser, and there are two ways to serve it.

### On a static host

The right fit when the server is embedded in your app or hosted on its own. The server's URL is baked in at build time, so the dashboard is built per deployment (the build needs Bun) — from the release tag matching your installed `@aikirun/*` version:

```bash
git clone --branch v0.31.0 https://github.com/aikirun/aiki.git
cd aiki
bun install
bun run build:types
VITE_AIKI_SERVER_URL=https://aiki.example.com bun run build:dashboard
```

Deploy `app/dashboard/dist/` to any static file host, and add the dashboard's origin to the server's `CORS_ORIGINS`. A build that forgot `VITE_AIKI_SERVER_URL` fails loudly in the browser: the dashboard reaches no server, and its error screen names the variable.

### As a Docker image

The image needs no build-time configuration: nginx inside it serves the dashboard and proxies its server calls to the address in `AIKI_SERVER_UPSTREAM_URL`, read at container start. Browser traffic stays on one origin, so no CORS setup is needed. From a clone of [aikirun/aiki](https://github.com/aikirun/aiki):

```bash
docker build -f app/dashboard/Dockerfile -t aikirun/dashboard .
docker run -p 9851:9851 -e AIKI_SERVER_UPSTREAM_URL=http://your-server:9850 aikirun/dashboard
```

## Environment Variable Reference

These apply to the standalone server and the dashboard. If you embed the server in your own app, you control configuration directly via the `server({...})` factory and don't need these.

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
| `VITE_AIKI_SERVER_URL` | If on a static host | — | Build-time server URL for a dashboard served outside the docker image |

Which variable applies depends on the deployment mode — see [Run the dashboard on its own](#run-the-dashboard-on-its-own). The bundled `docker-compose.yml` sets `AIKI_SERVER_UPSTREAM_URL` for you.

---

## Next Steps

- [Quick Start](./quick-start.md) — Create your first workflow
- **[Your First Workflow](./first-workflow.md)** — A multi-step workflow with events, child workflows, and durable sleep
