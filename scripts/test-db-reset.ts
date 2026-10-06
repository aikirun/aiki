import { loadDatabaseConfig } from "@aikirun/lib/db";
import { migrateReset } from "@aikirun/lib/db/migrate";

import { MIGRATIONS_TABLE as iamMigrationsTable } from "../sdk/iam/src/migrate";
import { MIGRATIONS_TABLE as serverMigrationsTable } from "../sdk/server/src/migrate";

const db = loadDatabaseConfig();
await migrateReset({ migrationsTable: serverMigrationsTable, db });
await migrateReset({ migrationsTable: iamMigrationsTable, db });
