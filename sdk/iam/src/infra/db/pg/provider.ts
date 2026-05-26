import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";

import * as iamSchema from "./schema/iam";

export type PgClient = ReturnType<typeof postgres>;

export function createPgHandle(client: PgClient): PgHandle {
	return drizzle(client, { schema: iamSchema });
}

export type PgHandle = ReturnType<typeof drizzle<typeof iamSchema>>;
export type PgTransaction = Parameters<Parameters<PgHandle["transaction"]>[0]>[0];
export type PgDb = PgHandle | PgTransaction;
