import { eq } from "drizzle-orm";

import type { SessionRepository } from "../../types/session";
import type { SqliteDb } from "../provider";
import { session } from "../schema";

export const createSessionRepository = (db: SqliteDb): SessionRepository => ({
	async clearActiveByNamespaceId(namespaceId) {
		await db.update(session).set({ activeNamespaceId: null }).where(eq(session.activeNamespaceId, namespaceId));
	},
});
