import { and, eq, lte } from "drizzle-orm";

import type { Database } from "..";
import { schedule } from "../schema/pg";

type ScheduleRow = typeof schedule.$inferSelect;
type ScheduleRowInsert = typeof schedule.$inferInsert;

export interface ScheduleRepository {
	create(input: ScheduleRowInsert): Promise<ScheduleRow>;
	getById(namespaceId: string, id: string): Promise<ScheduleRow | null>;
	getByReferenceId(namespaceId: string, referenceId: string): Promise<ScheduleRow | null>;
	listByWorkflowId(namespaceId: string, workflowId: string): Promise<ScheduleRow[]>;
	listDueSchedules(before: Date, limit?: number): Promise<ScheduleRow[]>;
}

export function createScheduleRepository(db: Database): ScheduleRepository {
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
