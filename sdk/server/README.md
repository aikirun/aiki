# @aikirun/server

The Aiki server as a library — orchestrates workflow runs and persists state in your database. Run it embedded in your app or as its own process.

## Installation

```bash
npm install @aikirun/server @aikirun/client @aikirun/memory            # SQLite
npm install @aikirun/server @aikirun/client @aikirun/memory postgres   # Postgres
```

SQLite needs no driver: Aiki uses the SQLite built into Node.js and Bun. Postgres needs `postgres`, which `@aikirun/server` declares as an optional peer dependency, so your package manager does not install it on its own.

`@aikirun/client` and `@aikirun/memory` are for the Quick Start below: the client that talks to the server, and the in-process timer priority queue.

## Quick Start

```typescript
import { client } from "@aikirun/client";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";
import { database, server } from "@aikirun/server";

const aikiServer = server({
	db: database({ provider: "sqlite", path: "./aiki.db" }),
	// or Postgres: database({ provider: "pg", url: databaseUrl })
	timerPriorityQueue: inMemoryTimerPriorityQueue(),
});
const runtimeHandle = aikiServer.runtime.start();

// In-process client — or serve aikiServer.handler over HTTP
const aikiClient = client({ handler: aikiServer.handler });
```

## Documentation

See the [Server](https://aiki.run/docs/architecture/server) architecture guide and the [Installation Guide](https://aiki.run/docs/getting-started/installation).

## License

Apache-2.0
