import { and, eq, lte } from "drizzle-orm";

import type { DatabaseConn } from "..";
import { schedule } from "../schema/pg";

type ScheduleRow = typeof schedule.$inferSelect;
type ScheduleRowInsert = typeof schedule.$inferInsert;

export function createScheduleRepository(db: DatabaseConn) {
	return {
		async create(input: ScheduleRowInsert): Promise<ScheduleRow> {
			const result = await db.insert(schedule).values(input).returning();
			const created = result[0];
			if (!created) {
				throw new Error("Failed to create schedule - no row returned");
			}
			return created;
		},

		async getById(namespaceId: string, id: string): Promise<ScheduleRow | null> {
			const result = await db
				.select()
				.from(schedule)
				.where(and(eq(schedule.namespaceId, namespaceId), eq(schedule.id, id)))
				.limit(1);
			return result[0] ?? null;
		},

		async getByReferenceId(namespaceId: string, referenceId: string): Promise<ScheduleRow | null> {
			const result = await db
				.select()
				.from(schedule)
				.where(and(eq(schedule.namespaceId, namespaceId), eq(schedule.referenceId, referenceId)))
				.limit(1);
			return result[0] ?? null;
		},

		async listByWorkflowId(namespaceId: string, workflowId: string): Promise<ScheduleRow[]> {
			return db
				.select()
				.from(schedule)
				.where(and(eq(schedule.namespaceId, namespaceId), eq(schedule.workflowId, workflowId)));
		},

		async listDueSchedules(before: Date, limit = 100): Promise<ScheduleRow[]> {
			return db
				.select()
				.from(schedule)
				.where(and(eq(schedule.status, "active"), lte(schedule.nextRunAt, before)))
				.limit(limit);
		},
	};
}

export type ScheduleRepository = ReturnType<typeof createScheduleRepository>;
