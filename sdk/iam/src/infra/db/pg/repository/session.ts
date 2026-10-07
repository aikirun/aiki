import { eq } from "drizzle-orm";

import type { PgDb } from "../provider";
import { session } from "../schema";

export const createSessionRepository = (db: PgDb) => ({
	async setActiveNamespace(sessionId: string, namespaceId: string): Promise<void> {
		await db.update(session).set({ activeNamespaceId: namespaceId }).where(eq(session.id, sessionId));
	},

	async clearActiveByNamespaceId(namespaceId: string): Promise<void> {
		await db.update(session).set({ activeNamespaceId: null }).where(eq(session.activeNamespaceId, namespaceId));
	},
});

export type SessionRepository = ReturnType<typeof createSessionRepository>;
