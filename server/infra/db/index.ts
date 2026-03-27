import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPgRepositories } from "./pg";
import { createPgDatabaseConn, type PgDatabaseOptions } from "./pg/provider";
import { betterAuthSchema as pgBetterAuthSchema } from "./pg/schema";
import { createSqliteRepositories } from "./sqlite";
import { createSqliteDatabase } from "./sqlite/provider";
import { betterAuthSchema as sqliteBetterAuthSchema } from "./sqlite/schema";

export type { Repositories } from "./types";
export * from "./types";

export type DatabaseOptions =
	| PgDatabaseOptions
	| { provider: "mysql"; url: string; maxConnections?: number; ssl?: boolean }
	| { provider: "sqlite"; path: string };

export function createDatabase(options: DatabaseOptions) {
	switch (options.provider) {
		case "pg": {
			const conn = createPgDatabaseConn(options);
			return {
				conn,
				repos: createPgRepositories(conn),
				betterAuthSchema: pgBetterAuthSchema,
				close: undefined,
			};
		}
		case "sqlite": {
			let tmpDir: string | undefined;
			let resolvedOptions = options;
			if (options.path === ":memory:") {
				tmpDir = mkdtempSync(join(tmpdir(), "aiki-"));
				resolvedOptions = { ...options, path: join(tmpDir, "aiki.db") };
			}
			const { raw, conn: reposConn, close: closeRepos } = createSqliteDatabase(resolvedOptions);
			const { conn: authConn, close: closeAuth } = createSqliteDatabase(resolvedOptions);
			return {
				conn: authConn,
				repos: createSqliteRepositories(reposConn, raw),
				betterAuthSchema: sqliteBetterAuthSchema,
				close: () => {
					closeRepos();
					closeAuth();
					if (tmpDir) {
						rmSync(tmpDir, { recursive: true, force: true });
					}
				},
			};
		}
		case "mysql":
			throw new Error("MySQL support not yet implemented");
		default:
			return options satisfies never;
	}
}
