import { type DatabaseProvider, loadDatabaseConfig } from "@aikirun/server/config";
import type { Config as DrizzleConfig } from "drizzle-kit";

const providerDialects: Record<DatabaseProvider, DrizzleConfig["dialect"]> = {
	pg: "postgresql",
	sqlite: "sqlite",
	mysql: "mysql",
};

const dbConfig = loadDatabaseConfig();

export default {
	schema: `./infra/db/${dbConfig.provider}/schema/*.ts`,
	out: `./infra/db/${dbConfig.provider}/migration`,
	dialect: providerDialects[dbConfig.provider],
	dbCredentials: dbConfig.provider === "sqlite" ? { url: dbConfig.path } : { url: dbConfig.url, ssl: dbConfig.ssl },
} satisfies DrizzleConfig;
