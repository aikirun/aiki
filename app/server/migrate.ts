import { migratePg } from "@aikirun/server/infra/db/pg/migrate";

import { loadConfig } from "./config";
import { createLogger } from "./logger";

const config = await loadConfig();
const logger = createLogger(config.logLevel, config.prettyLogs);

const { database } = config;

switch (database.provider) {
	case "pg":
		await migratePg(database, logger);
		break;
	case "sqlite":
		throw new Error("SQLite migrations not yet implemented");
	case "mysql":
		throw new Error("MySQL migrations not yet implemented");
	default:
		database satisfies never;
}

logger.info("migrations applied");
