# @aikirun/iam

Optional identity and access management for the Aiki server — organizations, namespaces, API keys, and dashboard auth. Off by default; compose it into the server to require credentials.

## Installation

```bash
npm install @aikirun/iam
```

## Quick Start

```typescript
import { iam } from "@aikirun/iam";
import { database, server } from "@aikirun/server";

const db = database({ provider: "pg", url: databaseUrl });

const aikiServer = server({
	db,
	handler: {
		iam: iam({
			db,
			secret: "your-auth-secret",
			baseURL: "http://localhost:9850",
			trustedOrigins: ["http://localhost:9851"],
		}),
	},
});
```

## Documentation

See the [IAM Guide](https://aiki.run/docs/guides/iam).

## License

Apache-2.0
