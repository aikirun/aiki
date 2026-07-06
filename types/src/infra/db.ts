import type { DatabaseProvider } from "@aikirun/lib/db";

import { INTERNAL } from "../symbols";

export interface Database {
	readonly provider: DatabaseProvider;
	readonly [INTERNAL]: { client: unknown };
}

export type CreateDatabase = () => Promise<Database>;
