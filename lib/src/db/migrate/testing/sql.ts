import { type DatabaseConfig, loadDatabaseConfig } from "../../config";

const dbConfig = loadDatabaseConfig();

// Postgres returns a bigint column as a string.
export function fromDatabaseBigint(value: number): number | string {
	switch (dbConfig.provider) {
		case "sqlite":
			return value;
		case "pg":
			return String(value);
		default:
			return dbConfig satisfies never;
	}
}

export async function runSql(db: DatabaseConfig, statement: string): Promise<Record<string, unknown>[]> {
	switch (db.provider) {
		case "sqlite": {
			const { openSqliteClient } = await import("../../sqlite");
			const client = await openSqliteClient(db);
			try {
				const queryResult = await client.execute(statement);
				return queryResult.rows.map((row) =>
					Object.fromEntries(queryResult.columns.map((column, columnIndex) => [column, row[columnIndex]]))
				);
			} finally {
				client.close();
			}
		}
		case "pg": {
			const { default: postgres } = await import("postgres");
			const client = postgres(db.url, { max: 1, onnotice: () => {} });
			try {
				return [...(await client.unsafe(statement))];
			} finally {
				await client.end();
			}
		}
		default:
			return db satisfies never;
	}
}
