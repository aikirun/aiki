import { loadDatabaseConfig } from "@aikirun/lib/db";
import { migrateReset } from "@aikirun/lib/db/migrate";

const db = loadDatabaseConfig();

switch (db.provider) {
	case "pg":
		await migrateReset({ db, schemas: ["public", "drizzle"] });
		break;
	case "sqlite":
		await migrateReset({ db });
		break;
	default:
		db satisfies never;
}
