import { eq } from "drizzle-orm";

import type { PgDb } from "../provider";
import { session } from "../schema";

export function createSessionRepository(db: PgDb) {
	return {
		async clearActiveByNamespaceId(namespaceId: string): Promise<void> {
			await db.update(session).set({ activeNamespaceId: null }).where(eq(session.activeNamespaceId, namespaceId));
		},
	};
}

export type SessionRepository = ReturnType<typeof createSessionRepository>;
