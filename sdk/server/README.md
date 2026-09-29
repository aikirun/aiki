# @aikirun/server

The Aiki server as a library — orchestrates workflow runs and persists state in your database. Run it embedded in your app or as its own process.

## Installation

```bash
npm install @aikirun/server @libsql/client   # SQLite
npm install @aikirun/server postgres         # Postgres
```

Install the driver for your database: `@libsql/client` for SQLite, `postgres` for Postgres. `@aikirun/server` declares both as optional peer dependencies, so your package manager does not install either on its own.

## Quick Start

```typescript
import { client } from "@aikirun/client";
import { database, server } from "@aikirun/server";

const aikiServer = server({ db: database({ provider: "sqlite", path: "./aiki.db" }) });
// or Postgres: database({ provider: "pg", url: databaseUrl })
const runtimeHandle = aikiServer.runtime.start();

// In-process client — or serve aikiServer.handler over HTTP
const aikiClient = client({ handler: aikiServer.handler });
```

## Documentation

See the [Server](https://aiki.run/docs/architecture/server) architecture guide and the [Installation Guide](https://aiki.run/docs/getting-started/installation).

## License

Apache-2.0
