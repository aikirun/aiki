import "dotenv/config";
import type { Config as DrizzleConfig } from "drizzle-kit";
import { DATABASE_PROVIDERS, type DatabaseConfig, isDatabaseProvider } from "server/config/schema";

const providerDialects: Record<DatabaseConfig["provider"], DrizzleConfig["dialect"]> = {
	pg: "postgresql",
	sqlite: "sqlite",
	mysql: "mysql",
};

const provider = process.env.DATABASE_PROVIDER || "pg";
const connectionString = process.env.DATABASE_URL;

if (!isDatabaseProvider(provider)) {
	throw new Error(`Unsupported DATABASE_PROVIDER: ${provider}. Supported: ${DATABASE_PROVIDERS.join(", ")}`);
}

if (!connectionString) {
	throw new Error("DATABASE_URL environment variable is required");
}

export default {
	schema: `./infra/db/schema/${provider}/*.ts`,
	out: `./infra/db/migrations/${provider}`,
	dialect: providerDialects[provider],
	dbCredentials: {
		url: connectionString,
	},
} satisfies DrizzleConfig;
