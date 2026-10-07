import { eq } from "drizzle-orm";

import type { SessionRepository } from "../../types/session";
import type { SqliteDb } from "../provider";
import { session } from "../schema";

export const createSessionRepository = (db: SqliteDb): SessionRepository => ({
	async setActiveNamespace(sessionId, namespaceId) {
		await db.update(session).set({ activeNamespaceId: namespaceId }).where(eq(session.id, sessionId));
	},

	async clearActiveByNamespaceId(namespaceId) {
		await db.update(session).set({ activeNamespaceId: null }).where(eq(session.activeNamespaceId, namespaceId));
	},
});
