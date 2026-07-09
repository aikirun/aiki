# Installation

How you install Aiki depends on what you're doing:

- **Building workflows** — add the SDK to your TypeScript project and run the server embedded in your app, or point your app at a hosted Aiki server. Follow [Add Aiki to your project](#add-aiki-to-your-project).
- **Hosting Aiki** — run the standalone server and web dashboard as infrastructure, with no SDK install. You need a PostgreSQL database. Run it from the prebuilt `aiki` binary, the ready-made Docker stack, or from source with Bun. Follow [Run the standalone server and dashboard](#run-the-standalone-server-and-dashboard).

## Add Aiki to your project

You need Node.js 18+ or Bun 1.0+, and a PostgreSQL 14+ database (SQLite and MySQL coming soon).

### Install the SDK packages

```bash
npm install @aikirun/workflow @aikirun/client @aikirun/worker @aikirun/server
```

### Apply the schema migration

If you will [run the standalone server](#run-the-standalone-server-and-dashboard), skip this step — that section covers migration for each way of running it.

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/aiki \
  npx aiki-server migrate apply
```

Re-run this command when upgrading Aiki to apply new migrations.

### Run the server

Mount aiki server handler in any HTTP framework — in the same process as your app, or in a process dedicated to Aiki. The [Quick Start](./quick-start.md) walks through this end-to-end, including worker and client.

Workflow code is identical against an embedded or standalone server, so you can also skip embedding entirely and point your client at a server hosted per [Run the standalone server and dashboard](#run-the-standalone-server-and-dashboard).

Want the web dashboard against your embedded server? Serve it separately — see [Run the dashboard on its own](#run-the-dashboard-on-its-own).

## Run the standalone server and dashboard

Hosting Aiki as infrastructure means running two components:

- **Server** — the Aiki server. Needs `DATABASE_URL`.

However you run the server, applications connect the same way:
```typescript
const aikiClient = client({ url: "http://localhost:9850" });
```

- **Dashboard** — the web UI, a single-page app that talks to the server.

Before the server starts, apply the schema. This one-off **migration step** applies the server package's migrations, plus the iam package's when the server runs with auth (`AIKI_SERVER_AUTH_SECRET`). It needs `DATABASE_URL`, and is safe to repeat: run it on a fresh database or when an aiki upgrade ships new migrations. Already-applied migrations are skipped.

There are three ways to run this stack:

- **The `aiki` binary** — one downloaded executable with its own runtime, no Node, Bun, or Docker to install.
- **Docker** — run the published images, brought up together by Compose or on their own. Best if you already run containers.
- **From source** — clone at a release tag and run with Bun. Best for contributors.

### With the aiki binary

Download the `aiki` binary for your platform from the [latest release](https://github.com/aikirun/aiki/releases/latest) and put it on your `PATH`. It carries the migrate and server commands plus its own runtime.

```bash
export DATABASE_URL=postgresql://user:password@your-db-host:5432/aiki

aiki migrate apply     # migrates the server package; use --package server,iam to include iam
aiki server start      # serves on :9850
```

Both commands read configuration from the environment; pass `--env-file <path>` to load it from a file instead.

The dashboard ships separately — serve it as a static site (see [Run the dashboard on its own](#run-the-dashboard-on-its-own)) or from a container (see [With Docker](#with-docker)). A dashboard on a different origin than the server needs its origin added to the server's `CORS_ORIGINS` (via `--env-file` or the environment).

### With Docker

The published images cover the stack: `ghcr.io/aikirun/cli` — the same `aiki` binary — runs the migration, `ghcr.io/aikirun/server` runs the server, and `ghcr.io/aikirun/dashboard` serves the web UI. Compose wires them together; you can also run them yourself.

#### With Docker Compose

Download the standalone compose file from the latest release into an empty directory — it pulls that release's published images, so there is nothing to clone or build:

```bash
mkdir aiki && cd aiki
curl -fsSL https://github.com/aikirun/aiki/releases/latest/download/docker-compose.yml -o docker-compose.yml
```

Create a `.env` next to it with your database URL:

```bash
DATABASE_URL=postgresql://user:password@your-db-host:5432/aiki
```

```bash
docker-compose up -d
```

- Server: http://localhost:9850
- Dashboard: http://localhost:9851

The migration step applies the packages listed in `AIKI_MIGRATE_PACKAGES` — by default `server`, plus `iam` when `AIKI_SERVER_AUTH_SECRET` is set. Override the list to depart from that, for example to create the iam tables before turning auth on: `AIKI_MIGRATE_PACKAGES=server,iam docker-compose up -d`.

#### Without Docker Compose

Run the images yourself when you orchestrate containers with your own tooling. Migrate first, then start the server and dashboard against it:

```bash
# migration
docker run --rm -e DATABASE_URL=postgresql://user:password@your-db-host:5432/aiki \
  ghcr.io/aikirun/cli:<version> migrate apply --package server

# server
docker run -p 9850:9850 -e DATABASE_URL=postgresql://user:password@your-db-host:5432/aiki \
  ghcr.io/aikirun/server:<version>

# dashboard, proxying browser calls to the server
docker run -p 9851:9851 -e AIKI_SERVER_UPSTREAM_URL=http://your-server:9850 \
  ghcr.io/aikirun/dashboard:<version>
```

Add `--package server,iam` to the migration when the server runs with auth. The dashboard image proxies to the server, so it needs no `CORS_ORIGINS`; to serve the dashboard from a static host instead, see [Run the dashboard on its own](#run-the-dashboard-on-its-own). Pick versions from the [releases](https://github.com/aikirun/aiki/releases).

### From source

The same stack runs without Docker (this path needs Bun). Clone at a release tag so you run released code:

```bash
git clone --branch v0.33.0 https://github.com/aikirun/aiki.git
cd aiki
bun install
cp app/server/.env.example app/server/.env
# Edit app/server/.env with your DATABASE_URL

bun run db:migrate:apply:server   # the migration step
bun run server                    # Terminal 1
bun run dashboard                 # Terminal 2
```

Run `bun run db:migrate:apply:iam` too when the server will run with auth. One piece differs from its container form: the dashboard here is a dev server, and the browser calls the Aiki server directly on `localhost:9850` — no proxy and no `AIKI_SERVER_UPSTREAM_URL` (the `.env.example` already allows the dashboard's origin through `CORS_ORIGINS`).

## Run the dashboard on its own

Serve the dashboard by itself when the server is embedded in your app (the [SDK path above](#add-aiki-to-your-project)) or hosted somewhere the bundled stack does not reach. It is a single-page app that calls the server from the browser. Serve it as a static site; to run it as a container instead, use the dashboard image under [With Docker](#with-docker).

The server's URL is baked into the bundle at build time, so the dashboard is built per deployment (the build needs Bun) — from the release tag matching your installed `@aikirun/*` version:

```bash
git clone --branch v0.33.0 https://github.com/aikirun/aiki.git
cd aiki
bun install
bun run build:types
VITE_AIKI_SERVER_URL=https://aiki.example.com bun run build:dashboard
```

Deploy `app/dashboard/dist/` to any static file host. Because the browser calls the server cross-origin, two things must line up: the build sets `VITE_AIKI_SERVER_URL` to the server's URL, and the server's `CORS_ORIGINS` allows the dashboard's origin. Miss either and the dashboard fails loudly in the browser — its error screen names both.

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
| `CORS_ORIGINS` | If the dashboard is cross-origin | — | Comma-separated allowed origins, e.g. a static-host dashboard's; unneeded behind the dashboard image's proxy |
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

Which variable applies depends on how you serve the dashboard: the docker image reads `AIKI_SERVER_UPSTREAM_URL` (see [With Docker](#with-docker)), and a static-host build reads `VITE_AIKI_SERVER_URL` (see [Run the dashboard on its own](#run-the-dashboard-on-its-own)). The bundled `docker-compose.yml` sets `AIKI_SERVER_UPSTREAM_URL` for you.

---

## Next Steps

- [Quick Start](./quick-start.md) — Create your first workflow
- **[Your First Workflow](./first-workflow.md)** — A multi-step workflow with events, child workflows, and durable sleep
