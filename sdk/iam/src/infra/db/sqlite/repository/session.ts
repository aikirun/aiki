import { eq } from "drizzle-orm";

import type { SqliteDb } from "../provider";
import { session } from "../schema";

export function createSessionRepository(db: SqliteDb) {
	return {
		async clearActiveByNamespaceId(namespaceId: string): Promise<void> {
			await db.update(session).set({ activeNamespaceId: null }).where(eq(session.activeNamespaceId, namespaceId));
		},
	};
}

export type SessionRepository = ReturnType<typeof createSessionRepository>;
