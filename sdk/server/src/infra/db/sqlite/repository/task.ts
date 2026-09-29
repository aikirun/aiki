import { asNonEmptyArray } from "@aikirun/lib/collection/array";
import { and, count, eq, inArray, min, ne, sql } from "drizzle-orm";

import { valuesTable } from "./lib/values-table";
import { toTaskState } from "../../state-transition-row";
import type { TaskRepository } from "../../types/task";
import type { SqliteDb } from "../provider";
import { stateTransition, task, workflowRun } from "../schema";

export const createTaskRepository = (db: SqliteDb): TaskRepository => ({
	async create(input) {
		const result = await db.insert(task).values(input).returning();
		const created = result[0];
		if (!created) {
			throw new Error("Failed to create task - no row returned");
		}
		return created;
	},

	async getById(params) {
		const result = await db
			.select()
			.from(task)
			.where(and(eq(task.id, params.id), eq(task.workflowRunId, params.workflowRunId)))
			.limit(1);
		return result[0] ?? null;
	},

	async getByIdWithState(namespaceId, id) {
		const result = await db
			.select({
				id: task.id,
				name: task.name,
				workflowRunId: task.workflowRunId,
				input: task.input,
				inputHash: task.inputHash,
				options: task.options,
				attempts: task.attempts,
				state: stateTransition.state,
			})
			.from(task)
			.innerJoin(workflowRun, eq(task.workflowRunId, workflowRun.id))
			.innerJoin(stateTransition, eq(task.latestStateTransitionId, stateTransition.id))
			.where(and(eq(workflowRun.namespaceId, namespaceId), eq(task.id, id)))
			.limit(1);

		const row = result[0];
		return row ? { ...row, state: toTaskState(row.state) } : null;
	},

	async update(filter, updates) {
		const result = await db
			.update(task)
			.set(updates)
			.where(
				and(
					eq(task.id, filter.id),
					eq(task.workflowRunId, filter.workflowRunId),
					eq(task.status, filter.status),
					eq(task.attempts, filter.attempts)
				)
			)
			.returning();
		return result[0] ?? null;
	},

	async listByWorkflowRunIdWithState(workflowRunId) {
		// TODO: explore loading in chunks
		const rows = await db
			.select({
				id: task.id,
				name: task.name,
				inputHash: task.inputHash,
				options: task.options,
				attempts: task.attempts,
				state: stateTransition.state,
			})
			.from(task)
			.innerJoin(stateTransition, eq(task.latestStateTransitionId, stateTransition.id))
			.where(and(eq(task.workflowRunId, workflowRunId), ne(task.status, "discarded")))
			.orderBy(task.id)
			.limit(10_000);

		return rows.map((row) => ({ ...row, state: toTaskState(row.state) }));
	},

	async getEarliestNextAttemptAt(workflowRunId) {
		const result = await db
			.select({ nextAttemptAt: min(task.nextAttemptAt) })
			.from(task)
			.where(and(eq(task.workflowRunId, workflowRunId), eq(task.status, "awaiting_retry")));
		return result[0]?.nextAttemptAt ?? null;
	},

	async listByWorkflowRunIdsAndStatuses(workflowRunIds, statuses) {
		const runIdsFilter =
			typeof workflowRunIds === "string"
				? eq(task.workflowRunId, workflowRunIds)
				: inArray(task.workflowRunId, workflowRunIds);
		return db
			.select({ id: task.id, workflowRunId: task.workflowRunId, attempts: task.attempts, status: task.status })
			.from(task)
			.where(and(runIdsFilter, inArray(task.status, statuses)));
	},

	async countByWorkflowRunIds(workflowRunIds) {
		const rows = await db
			.select({
				workflowRunId: task.workflowRunId,
				status: task.status,
				count: count(),
			})
			.from(task)
			.where(inArray(task.workflowRunId, workflowRunIds))
			.groupBy(task.workflowRunId, task.status);

		const result: Awaited<ReturnType<TaskRepository["countByWorkflowRunIds"]>> = new Map();
		for (const row of rows) {
			let taskCounts = result.get(row.workflowRunId);
			if (!taskCounts) {
				taskCounts = { completed: 0, running: 0, failed: 0, awaiting_retry: 0, discarded: 0 };
				result.set(row.workflowRunId, taskCounts);
			}
			taskCounts[row.status] = row.count;
		}
		return result;
	},

	async bulkTransitionToDiscarded(tasks) {
		const valueRows = asNonEmptyArray(
			tasks.map(
				({ filter, update }) =>
					sql`(${filter.id}, ${filter.workflowRunId}, ${filter.status}, ${filter.attempts}, ${update.latestStateTransitionId})`
			)
		);

		const result = await db
			.update(task)
			.set({
				status: "discarded",
				nextAttemptAt: null,
				latestStateTransitionId: sql`v.state_transition_id`,
			})
			.from(valuesTable("v", ["id", "workflow_run_id", "status", "attempts", "state_transition_id"], valueRows))
			.where(
				sql`${task.id} = v.id AND ${task.workflowRunId} = v.workflow_run_id AND ${task.status} = v.status AND ${task.attempts} = v.attempts`
			)
			.returning({ id: task.id });

		return result.map((row) => row.id);
	},
});
