import type { DatabaseProvider } from "@aikirun/lib/db";

import { INTERNAL } from "../symbols";

export interface Database {
	readonly provider: DatabaseProvider;
	readonly [INTERNAL]: { client: unknown };
}

export interface DatabaseCloseOptions {
	/**
	 * How long to wait for queries that are still running before closing the connections
	 * (default: 5 seconds).
	 */
	timeoutMs?: number;
}

export interface CreateDatabase {
	(): Promise<Database>;
	close(options?: DatabaseCloseOptions): Promise<void>;
}
