import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import type { AtMostOneProp } from "@aikirun/lib/object";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { WorkflowSource } from "@aikirun/types/workflow";
import type {
	WaitingForSignalWorkflowRunStatus,
	WorkflowRunId,
	WorkflowRunOptions,
	WorkflowRunState,
	WorkflowRunStatus,
} from "@aikirun/types/workflow/run";
import { NON_TERMINAL_WORKFLOW_RUN_STATUSES } from "@aikirun/types/workflow/run";
import { and, count, eq, inArray, lte, or, sql } from "drizzle-orm";

import { keysetStreamCursorFilter } from "./lib/keyset-stream";
import { toWorkflowRunState } from "./state-transition";
import type { WorkflowRow } from "./workflow";
import type { KeysetStreamCursor } from "../../../../lib/keyset-stream";
import type { DaemonContext } from "../../../../middleware/context";
import type { PgDb } from "../provider";
import { stateTransition, workflow, workflowRun } from "../schema";

export type WorkflowRunRow = typeof workflowRun.$inferSelect;
export type WorkflowRunRowInsert = typeof workflowRun.$inferInsert;

export type UpdateWorkflowRunParams =
	| {
			waitForSignal: true;
			filter: { namespaceId: NamespaceId; id: WorkflowRunId; revision: number; signalSequence: number };
			updates: {
				attempts: number;
				latestStateTransitionId: string;
				onSignalSequenceMatch: { status: WaitingForSignalWorkflowRunStatus; timeoutAt: TimestampMs | null };
				onSignalSequenceMismatch: { status: "scheduled"; scheduledAt: TimestampMs };
			};
	  }
	| {
			waitForSignal: false;
			filter: { namespaceId: NamespaceId; id: WorkflowRunId; revision?: number };
			updates: {
				status: Exclude<WorkflowRunStatus, WaitingForSignalWorkflowRunStatus>;
				attempts: number;
				latestStateTransitionId: string;
			} & AtMostOneProp<{ scheduledAt: TimestampMs; wakeupAt: TimestampMs; nextAttemptAt: TimestampMs }>;
	  };

export type WorkflowRunWithState = {
	run: Pick<
		WorkflowRunRow,
		| "id"
		| "status"
		| "revision"
		| "signalSequence"
		| "attempts"
		| "latestStateTransitionId"
		| "options"
		| "parentWorkflowRunId"
	>;
	state: WorkflowRunState;
};

export type WorkflowRunWithWorkflowAndState = {
	run: Pick<
		WorkflowRunRow,
		| "id"
		| "createdAt"
		| "revision"
		| "signalSequence"
		| "attempts"
		| "latestStateTransitionId"
		| "input"
		| "inputHash"
		| "referenceId"
		| "options"
		| "parentWorkflowRunId"
		| "scheduleId"
	>;
	workflow: Pick<WorkflowRow, "name" | "versionId" | "source">;
	state: WorkflowRunState;
};

export type ChildRunWithWorkflow = {
	run: Pick<WorkflowRunRow, "id" | "inputHash" | "referenceId">;
	workflow: Pick<WorkflowRow, "name" | "versionId">;
};

export interface WorkflowRunMeta {
	id: string;
	namespaceId: string;
	workflowId: string;
	revision: number;
	attempts: number;
	options: WorkflowRunOptions | null;
	latestStateTransitionId: string;
}

export interface DueWorkflowRun extends WorkflowRunMeta {
	dueAt: TimestampMs;
}

export const createWorkflowRunRepository = (db: PgDb) => ({
	async insert(input: WorkflowRunRowInsert | NonEmptyArray<WorkflowRunRowInsert>): Promise<void> {
		const values = Array.isArray(input) ? input : [input];
		await db.insert(workflowRun).values(values);
	},

	async update(params: UpdateWorkflowRunParams): Promise<{ revision: number; signalSequence: number } | null> {
		const { filter } = params;
		const conditions = [eq(workflowRun.namespaceId, filter.namespaceId), eq(workflowRun.id, filter.id)];
		if (filter.revision !== undefined) {
			conditions.push(eq(workflowRun.revision, filter.revision));
		}

		if (params.waitForSignal) {
			const { filter, updates } = params;
			const { onSignalSequenceMatch, onSignalSequenceMismatch } = updates;
			const signalSequenceMatches = sql`${workflowRun.signalSequence} = ${filter.signalSequence}`;
			const timeoutAtIso =
				onSignalSequenceMatch.timeoutAt === null ? null : new Date(onSignalSequenceMatch.timeoutAt).toISOString();
			const scheduledAtIso = new Date(onSignalSequenceMismatch.scheduledAt).toISOString();

			const result = await db
				.update(workflowRun)
				.set({
					revision: sql`${workflowRun.revision} + 1`,
					attempts: updates.attempts,
					latestStateTransitionId: updates.latestStateTransitionId,
					status: sql`CASE WHEN ${signalSequenceMatches} THEN ${onSignalSequenceMatch.status}::workflow_run_status ELSE ${onSignalSequenceMismatch.status}::workflow_run_status END`,
					timeoutAt: sql`CASE WHEN ${signalSequenceMatches} THEN ${timeoutAtIso}::timestamptz ELSE NULL END`,
					scheduledAt: sql`CASE WHEN ${signalSequenceMatches} THEN NULL ELSE ${scheduledAtIso}::timestamptz END`,
					wakeupAt: null,
					nextAttemptAt: null,
				})
				.where(and(...conditions))
				.returning({ revision: workflowRun.revision, signalSequence: workflowRun.signalSequence });

			return result[0] ?? null;
		}

		const { updates } = params;
		const result = await db
			.update(workflowRun)
			.set({
				revision: sql`${workflowRun.revision} + 1`,
				status: updates.status,
				attempts: updates.attempts,
				latestStateTransitionId: updates.latestStateTransitionId,
				timeoutAt: null,
				scheduledAt: "scheduledAt" in updates ? updates.scheduledAt : null,
				wakeupAt: "wakeupAt" in updates ? updates.wakeupAt : null,
				nextAttemptAt: "nextAttemptAt" in updates ? updates.nextAttemptAt : null,
			})
			.where(and(...conditions))
			.returning({ revision: workflowRun.revision, signalSequence: workflowRun.signalSequence });

		return result[0] ?? null;
	},

	async incrementSignalSequence(filter: { namespaceId: NamespaceId; id: WorkflowRunId }) {
		const result = await db
			.update(workflowRun)
			.set({ signalSequence: sql`${workflowRun.signalSequence} + 1` })
			.from(stateTransition)
			.where(
				and(
					eq(workflowRun.namespaceId, filter.namespaceId),
					eq(workflowRun.id, filter.id),
					eq(stateTransition.id, workflowRun.latestStateTransitionId)
				)
			)
			.returning({
				run: {
					status: workflowRun.status,
					revision: workflowRun.revision,
					signalSequence: workflowRun.signalSequence,
				},
				state: stateTransition.state,
			});

		const row = result[0];
		if (!row) {
			return null;
		}
		return { run: row.run, state: toWorkflowRunState(row.state) };
	},

	async bulkIncrementSignalSequence(runs: NonEmptyArray<{ namespaceId: NamespaceId; id: WorkflowRunId }>) {
		// Locked in id order so concurrent bulk deliveries acquire the same rows the same way.
		const sortedRuns = [...runs].sort((a, b) => (a.id < b.id ? -1 : 1));
		const valueRows = sortedRuns.map(({ namespaceId, id }, index) => {
			if (index === 0) {
				return sql`(${namespaceId}::text, ${id}::text)`;
			}
			return sql`(${namespaceId}, ${id})`;
		});

		return db
			.update(workflowRun)
			.set({ signalSequence: sql`${workflowRun.signalSequence} + 1` })
			.from(sql`(VALUES ${sql.join(valueRows, sql`, `)}) AS v(namespace_id, id)`)
			.where(and(sql`${workflowRun.namespaceId} = v.namespace_id`, sql`${workflowRun.id} = v.id`))
			.returning({
				id: workflowRun.id,
				namespaceId: workflowRun.namespaceId,
				status: workflowRun.status,
				revision: workflowRun.revision,
				signalSequence: workflowRun.signalSequence,
				attempts: workflowRun.attempts,
				latestStateTransitionId: workflowRun.latestStateTransitionId,
				options: workflowRun.options,
			});
	},

	async exists(namespaceId: NamespaceId, id: string): Promise<boolean> {
		const result = await db
			.select({ id: workflowRun.id })
			.from(workflowRun)
			.where(and(eq(workflowRun.namespaceId, namespaceId), eq(workflowRun.id, id)))
			.limit(1);
		return result.length > 0;
	},

	async getById(filter: { namespaceId: NamespaceId; id: string }, options?: { lock?: "share" }) {
		const query = db
			.select({ id: workflowRun.id, revision: workflowRun.revision, status: workflowRun.status })
			.from(workflowRun)
			.where(and(eq(workflowRun.namespaceId, filter.namespaceId), eq(workflowRun.id, filter.id)))
			.limit(1);

		const result = options?.lock ? await query.for(options.lock) : await query;
		return result[0] ?? null;
	},

	async getByIdWithState(
		filter: { namespaceId: NamespaceId; id: string },
		options?: { lock?: "update" }
	): Promise<WorkflowRunWithState | null> {
		const query = db
			.select({
				run: {
					id: workflowRun.id,
					status: workflowRun.status,
					revision: workflowRun.revision,
					signalSequence: workflowRun.signalSequence,
					attempts: workflowRun.attempts,
					latestStateTransitionId: workflowRun.latestStateTransitionId,
					options: workflowRun.options,
					parentWorkflowRunId: workflowRun.parentWorkflowRunId,
				},
				state: stateTransition.state,
			})
			.from(workflowRun)
			.innerJoin(stateTransition, eq(workflowRun.latestStateTransitionId, stateTransition.id))
			.where(and(eq(workflowRun.namespaceId, filter.namespaceId), eq(workflowRun.id, filter.id)))
			.limit(1);

		const result = options?.lock ? await query.for(options.lock, { of: workflowRun }) : await query;
		const row = result[0];
		if (!row) {
			return null;
		}
		return { run: row.run, state: toWorkflowRunState(row.state) };
	},

	async getByIdWithWorkflowAndState(filter: {
		namespaceId: NamespaceId;
		id: string;
	}): Promise<WorkflowRunWithWorkflowAndState | null> {
		const result = await db
			.select({
				run: {
					id: workflowRun.id,
					createdAt: workflowRun.createdAt,
					revision: workflowRun.revision,
					signalSequence: workflowRun.signalSequence,
					attempts: workflowRun.attempts,
					latestStateTransitionId: workflowRun.latestStateTransitionId,
					input: workflowRun.input,
					inputHash: workflowRun.inputHash,
					referenceId: workflowRun.referenceId,
					options: workflowRun.options,
					parentWorkflowRunId: workflowRun.parentWorkflowRunId,
					scheduleId: workflowRun.scheduleId,
				},
				workflow: { name: workflow.name, versionId: workflow.versionId, source: workflow.source },
				state: stateTransition.state,
			})
			.from(workflowRun)
			.innerJoin(workflow, eq(workflowRun.workflowId, workflow.id))
			.innerJoin(stateTransition, eq(workflowRun.latestStateTransitionId, stateTransition.id))
			.where(and(eq(workflowRun.namespaceId, filter.namespaceId), eq(workflowRun.id, filter.id)))
			.limit(1);

		const row = result[0];
		if (!row) {
			return null;
		}
		return { run: row.run, workflow: row.workflow, state: toWorkflowRunState(row.state) };
	},

	async getByReferenceWithWorkflowAndState(filter: {
		namespaceId: NamespaceId;
		name: string;
		versionId: string;
		source: WorkflowSource;
		referenceId: string;
	}) {
		const result = await db
			.select({
				run: {
					id: workflowRun.id,
					createdAt: workflowRun.createdAt,
					revision: workflowRun.revision,
					signalSequence: workflowRun.signalSequence,
					attempts: workflowRun.attempts,
					latestStateTransitionId: workflowRun.latestStateTransitionId,
					input: workflowRun.input,
					inputHash: workflowRun.inputHash,
					referenceId: workflowRun.referenceId,
					options: workflowRun.options,
					parentWorkflowRunId: workflowRun.parentWorkflowRunId,
					scheduleId: workflowRun.scheduleId,
				},
				workflow: { name: workflow.name, versionId: workflow.versionId, source: workflow.source },
				state: stateTransition.state,
			})
			.from(workflowRun)
			.innerJoin(workflow, eq(workflowRun.workflowId, workflow.id))
			.innerJoin(stateTransition, eq(workflowRun.latestStateTransitionId, stateTransition.id))
			.where(
				and(
					eq(workflow.namespaceId, filter.namespaceId),
					eq(workflow.name, filter.name),
					eq(workflow.versionId, filter.versionId),
					eq(workflow.source, filter.source),
					eq(workflowRun.referenceId, filter.referenceId)
				)
			)
			.limit(1);

		const row = result[0];
		if (!row) {
			return null;
		}
		return { run: row.run, workflow: row.workflow, state: toWorkflowRunState(row.state) };
	},

	async listByIdsAndStatus(_context: DaemonContext, ids: NonEmptyArray<string>, status: WorkflowRunStatus) {
		return db
			.select({
				id: workflowRun.id,
				namespaceId: workflowRun.namespaceId,
				workflowId: workflowRun.workflowId,
				revision: workflowRun.revision,
				attempts: workflowRun.attempts,
				options: workflowRun.options,
				latestStateTransitionId: workflowRun.latestStateTransitionId,
			})
			.from(workflowRun)
			.where(and(inArray(workflowRun.id, ids), eq(workflowRun.status, status)));
	},

	async getChildRuns(filter: {
		namespaceId: NamespaceId;
		id: string;
		childRunStatus?: NonEmptyArray<WorkflowRunStatus>;
	}) {
		// TODO: explore loading in chunks
		const conditions = [
			eq(workflowRun.namespaceId, filter.namespaceId),
			eq(workflowRun.parentWorkflowRunId, filter.id),
		];
		if (filter.childRunStatus) {
			conditions.push(inArray(workflowRun.status, filter.childRunStatus));
		}

		return db
			.select({ id: workflowRun.id, options: workflowRun.options })
			.from(workflowRun)
			.where(and(...conditions))
			.limit(10_000);
	},

	async getChildRunsWithWorkflow(filter: { namespaceId: NamespaceId; id: string }): Promise<ChildRunWithWorkflow[]> {
		// TODO: explore loading in chunks
		return db
			.select({
				run: {
					id: workflowRun.id,
					inputHash: workflowRun.inputHash,
					referenceId: workflowRun.referenceId,
				},
				workflow: { name: workflow.name, versionId: workflow.versionId },
			})
			.from(workflowRun)
			.innerJoin(workflow, eq(workflowRun.workflowId, workflow.id))
			.where(and(eq(workflowRun.namespaceId, filter.namespaceId), eq(workflowRun.parentWorkflowRunId, filter.id)))
			.limit(10_000);
	},

	async hasChildRuns(
		runs: NonEmptyArray<{ id: string }>,
		childRunStatus?: NonEmptyArray<WorkflowRunStatus>
	): Promise<Set<string>> {
		const conditions = [
			inArray(
				workflowRun.parentWorkflowRunId,
				runs.map((run) => run.id)
			),
		];
		if (childRunStatus) {
			conditions.push(inArray(workflowRun.status, childRunStatus));
		}

		const rows = await db
			.select({ parentWorkflowRunId: workflowRun.parentWorkflowRunId })
			.from(workflowRun)
			.where(and(...conditions))
			.groupBy(workflowRun.parentWorkflowRunId);

		const result = new Set<string>();
		for (const row of rows) {
			if (row.parentWorkflowRunId) {
				result.add(row.parentWorkflowRunId);
			}
		}
		return result;
	},

	async getByWorkflowAndReferenceId(filter: { namespaceId: NamespaceId; workflowId: string; referenceId: string }) {
		const result = await db
			.select({ id: workflowRun.id, inputHash: workflowRun.inputHash })
			.from(workflowRun)
			.where(
				and(
					eq(workflowRun.namespaceId, filter.namespaceId),
					eq(workflowRun.workflowId, filter.workflowId),
					eq(workflowRun.referenceId, filter.referenceId)
				)
			)
			.limit(1);
		return result[0] ?? null;
	},

	async listByWorkflowAndReferenceIdPairs(filter: {
		pairs: NonEmptyArray<{ namespaceId: NamespaceId; workflowId: string; referenceId: string }>;
		status?: NonEmptyArray<WorkflowRunStatus>;
	}) {
		const pairConditions = or(
			...filter.pairs.map(({ namespaceId, workflowId, referenceId }) =>
				and(
					eq(workflowRun.namespaceId, namespaceId),
					eq(workflowRun.workflowId, workflowId),
					eq(workflowRun.referenceId, referenceId)
				)
			)
		);
		const conditions = filter.status ? and(pairConditions, inArray(workflowRun.status, filter.status)) : pairConditions;

		return db
			.select({
				id: workflowRun.id,
				workflowId: workflowRun.workflowId,
				referenceId: workflowRun.referenceId,
				attempts: workflowRun.attempts,
				options: workflowRun.options,
			})
			.from(workflowRun)
			.where(conditions);
	},

	// TODO: remove offset based pagination
	async listByFilters(
		filter: {
			namespaceId: NamespaceId;
			id?: string;
			scheduleId?: string;
			status?: NonEmptyArray<WorkflowRunStatus>;
			workflow?: {
				ids: NonEmptyArray<string>;
				referenceId?: string;
			};
		},
		limit: number,
		offset: number,
		sort: { order: "asc" | "desc" }
	) {
		const conditions = [eq(workflowRun.namespaceId, filter.namespaceId)];
		if (filter.id) {
			conditions.push(eq(workflowRun.id, filter.id));
		}
		if (filter.scheduleId) {
			conditions.push(eq(workflowRun.scheduleId, filter.scheduleId));
		}
		if (filter.status) {
			conditions.push(inArray(workflowRun.status, filter.status));
		}
		if (filter.workflow) {
			conditions.push(inArray(workflowRun.workflowId, filter.workflow.ids));
			if (filter.workflow.referenceId) {
				conditions.push(eq(workflowRun.referenceId, filter.workflow.referenceId));
			}
		}

		const whereClause = and(...conditions);
		const orderBy = sql`${workflowRun.id} ${sql.raw(sort.order)}`;

		const [rows, countResult] = await Promise.all([
			db
				.select({
					id: workflowRun.id,
					status: workflowRun.status,
					referenceId: workflowRun.referenceId,
					createdAt: workflowRun.createdAt,
					name: workflow.name,
					versionId: workflow.versionId,
				})
				.from(workflowRun)
				.innerJoin(workflow, eq(workflowRun.workflowId, workflow.id))
				.where(whereClause)
				.orderBy(orderBy)
				.limit(limit)
				.offset(offset),
			db.select({ count: count() }).from(workflowRun).where(whereClause),
		]);

		return { rows, total: countResult[0]?.count ?? 0 };
	},

	async countByStatus(
		filter: { namespaceId: NamespaceId } | { workflowIds: NonEmptyArray<string> }
	): Promise<Array<{ status: WorkflowRunStatus; count: number }>> {
		const whereClause =
			"workflowIds" in filter
				? inArray(workflowRun.workflowId, filter.workflowIds)
				: eq(workflowRun.namespaceId, filter.namespaceId);

		return db
			.select({
				status: workflowRun.status,
				count: count(),
			})
			.from(workflowRun)
			.where(whereClause)
			.groupBy(workflowRun.status);
	},

	async listDueScheduleRuns(
		_context: DaemonContext,
		before: TimestampMs,
		limit: number,
		cursor?: KeysetStreamCursor
	): Promise<DueWorkflowRun[]> {
		return db
			.select({
				id: workflowRun.id,
				namespaceId: workflowRun.namespaceId,
				workflowId: workflowRun.workflowId,
				revision: workflowRun.revision,
				attempts: workflowRun.attempts,
				options: workflowRun.options,
				latestStateTransitionId: workflowRun.latestStateTransitionId,
				dueAt: sql<TimestampMs>`${workflowRun.scheduledAt}`.mapWith(workflowRun.scheduledAt),
			})
			.from(workflowRun)
			.where(
				and(
					eq(workflowRun.status, "scheduled"),
					lte(workflowRun.scheduledAt, before),
					keysetStreamCursorFilter(workflowRun.scheduledAt, workflowRun.id, cursor)
				)
			)
			.orderBy(workflowRun.scheduledAt, workflowRun.id)
			.limit(limit);
	},

	async listSleepElapsedRuns(
		_context: DaemonContext,
		before: TimestampMs,
		limit: number,
		cursor?: KeysetStreamCursor
	): Promise<DueWorkflowRun[]> {
		return db
			.select({
				id: workflowRun.id,
				namespaceId: workflowRun.namespaceId,
				workflowId: workflowRun.workflowId,
				revision: workflowRun.revision,
				attempts: workflowRun.attempts,
				options: workflowRun.options,
				latestStateTransitionId: workflowRun.latestStateTransitionId,
				dueAt: sql<TimestampMs>`${workflowRun.wakeupAt}`.mapWith(workflowRun.wakeupAt),
			})
			.from(workflowRun)
			.where(
				and(
					eq(workflowRun.status, "sleeping"),
					lte(workflowRun.wakeupAt, before),
					keysetStreamCursorFilter(workflowRun.wakeupAt, workflowRun.id, cursor)
				)
			)
			.orderBy(workflowRun.wakeupAt, workflowRun.id)
			.limit(limit);
	},

	async listRetryableRuns(
		_context: DaemonContext,
		before: TimestampMs,
		limit: number,
		cursor?: KeysetStreamCursor
	): Promise<DueWorkflowRun[]> {
		return db
			.select({
				id: workflowRun.id,
				namespaceId: workflowRun.namespaceId,
				workflowId: workflowRun.workflowId,
				revision: workflowRun.revision,
				attempts: workflowRun.attempts,
				options: workflowRun.options,
				latestStateTransitionId: workflowRun.latestStateTransitionId,
				dueAt: sql<TimestampMs>`${workflowRun.nextAttemptAt}`.mapWith(workflowRun.nextAttemptAt),
			})
			.from(workflowRun)
			.where(
				and(
					eq(workflowRun.status, "awaiting_retry"),
					lte(workflowRun.nextAttemptAt, before),
					keysetStreamCursorFilter(workflowRun.nextAttemptAt, workflowRun.id, cursor)
				)
			)
			.orderBy(workflowRun.nextAttemptAt, workflowRun.id)
			.limit(limit);
	},

	async listTaskRetryableRuns(
		_context: DaemonContext,
		before: TimestampMs,
		limit: number,
		cursor?: KeysetStreamCursor
	): Promise<DueWorkflowRun[]> {
		return db
			.select({
				id: workflowRun.id,
				namespaceId: workflowRun.namespaceId,
				workflowId: workflowRun.workflowId,
				revision: workflowRun.revision,
				attempts: workflowRun.attempts,
				options: workflowRun.options,
				latestStateTransitionId: workflowRun.latestStateTransitionId,
				dueAt: sql<TimestampMs>`${workflowRun.nextAttemptAt}`.mapWith(workflowRun.nextAttemptAt),
			})
			.from(workflowRun)
			.where(
				and(
					eq(workflowRun.status, "awaiting_task_retry"),
					lte(workflowRun.nextAttemptAt, before),
					keysetStreamCursorFilter(workflowRun.nextAttemptAt, workflowRun.id, cursor)
				)
			)
			.orderBy(workflowRun.nextAttemptAt, workflowRun.id)
			.limit(limit);
	},

	async listEventWaitTimedOutRuns(
		_context: DaemonContext,
		before: TimestampMs,
		limit: number,
		cursor?: KeysetStreamCursor
	): Promise<DueWorkflowRun[]> {
		return db
			.select({
				id: workflowRun.id,
				namespaceId: workflowRun.namespaceId,
				workflowId: workflowRun.workflowId,
				revision: workflowRun.revision,
				attempts: workflowRun.attempts,
				options: workflowRun.options,
				latestStateTransitionId: workflowRun.latestStateTransitionId,
				dueAt: sql<TimestampMs>`${workflowRun.timeoutAt}`.mapWith(workflowRun.timeoutAt),
			})
			.from(workflowRun)
			.where(
				and(
					eq(workflowRun.status, "awaiting_event"),
					lte(workflowRun.timeoutAt, before),
					keysetStreamCursorFilter(workflowRun.timeoutAt, workflowRun.id, cursor)
				)
			)
			.orderBy(workflowRun.timeoutAt, workflowRun.id)
			.limit(limit);
	},

	async listChildRunWaitTimedOutRuns(
		_context: DaemonContext,
		before: TimestampMs,
		limit: number,
		cursor?: KeysetStreamCursor
	): Promise<DueWorkflowRun[]> {
		return db
			.select({
				id: workflowRun.id,
				namespaceId: workflowRun.namespaceId,
				workflowId: workflowRun.workflowId,
				revision: workflowRun.revision,
				attempts: workflowRun.attempts,
				options: workflowRun.options,
				latestStateTransitionId: workflowRun.latestStateTransitionId,
				dueAt: sql<TimestampMs>`${workflowRun.timeoutAt}`.mapWith(workflowRun.timeoutAt),
			})
			.from(workflowRun)
			.where(
				and(
					eq(workflowRun.status, "awaiting_child_workflow"),
					lte(workflowRun.timeoutAt, before),
					keysetStreamCursorFilter(workflowRun.timeoutAt, workflowRun.id, cursor)
				)
			)
			.orderBy(workflowRun.timeoutAt, workflowRun.id)
			.limit(limit);
	},

	async bulkTransitionToScheduled(
		fromStatus: WaitingForSignalWorkflowRunStatus,
		scheduledAt: TimestampMs,
		runs: NonEmptyArray<{
			filter: { namespaceId: NamespaceId; id: string; revision: number };
			update: { stateTransitionId: string };
		}>
	): Promise<string[]> {
		const valueRows = runs.map(({ filter, update }, index) => {
			if (index === 0) {
				return sql`(${filter.namespaceId}::text, ${filter.id}::text, ${filter.revision}::integer, ${update.stateTransitionId}::text)`;
			}
			return sql`(${filter.namespaceId}, ${filter.id}, ${filter.revision}, ${update.stateTransitionId})`;
		});

		const result = await db
			.update(workflowRun)
			.set({
				status: "scheduled",
				revision: sql`${workflowRun.revision} + 1`,
				scheduledAt,
				wakeupAt: null,
				timeoutAt: null,
				nextAttemptAt: null,
				latestStateTransitionId: sql`v.state_transition_id`,
			})
			.from(sql`(VALUES ${sql.join(valueRows, sql`, `)}) AS v(namespace_id, id, revision, state_transition_id)`)
			.where(
				and(
					eq(workflowRun.status, fromStatus),
					sql`${workflowRun.namespaceId} = v.namespace_id`,
					sql`${workflowRun.id} = v.id`,
					sql`${workflowRun.revision} = v.revision`
				)
			)
			.returning({ id: workflowRun.id });

		return result.map((row) => row.id);
	},

	async bulkTransitionToQueued(
		_context: DaemonContext,
		fromStatus:
			| "scheduled"
			| "sleeping"
			| "awaiting_retry"
			| "awaiting_task_retry"
			| "awaiting_event"
			| "awaiting_child_workflow",
		runs: NonEmptyArray<{ filter: { id: string; revision: number }; update: { stateTransitionId: string } }>,
		options?: { incrementAttempts?: boolean }
	): Promise<string[]> {
		const valueRows = runs.map(({ filter, update }, index) => {
			if (index === 0) {
				return sql`(${filter.id}::text, ${filter.revision}::integer, ${update.stateTransitionId}::text)`;
			}
			return sql`(${filter.id}, ${filter.revision}, ${update.stateTransitionId})`;
		});

		const result = await db
			.update(workflowRun)
			.set({
				status: "queued",
				revision: sql`${workflowRun.revision} + 1`,
				attempts: options?.incrementAttempts ? sql`${workflowRun.attempts} + 1` : workflowRun.attempts,
				scheduledAt: null,
				wakeupAt: null,
				timeoutAt: null,
				nextAttemptAt: null,
				latestStateTransitionId: sql`v.state_transition_id`,
			})
			.from(sql`(VALUES ${sql.join(valueRows, sql`, `)}) AS v(id, revision, state_transition_id)`)
			.where(
				and(
					eq(workflowRun.status, fromStatus),
					sql`${workflowRun.id} = v.id`,
					sql`${workflowRun.revision} = v.revision`
				)
			)
			.returning({ id: workflowRun.id });

		return result.map((row) => row.id);
	},

	async bulkTransitionToCancelledInNamespace(namespaceId: NamespaceId, runIds: NonEmptyArray<string>) {
		const result = await db
			.update(workflowRun)
			.set({
				status: "cancelled",
				revision: sql`${workflowRun.revision} + 1`,
				scheduledAt: null,
				wakeupAt: null,
				timeoutAt: null,
				nextAttemptAt: null,
			})
			.where(
				and(
					eq(workflowRun.namespaceId, namespaceId),
					inArray(workflowRun.id, runIds),
					inArray(workflowRun.status, NON_TERMINAL_WORKFLOW_RUN_STATUSES)
				)
			)
			.returning({
				id: workflowRun.id,
				attempts: workflowRun.attempts,
				options: workflowRun.options,
				parentWorkflowRunId: workflowRun.parentWorkflowRunId,
			});

		return result;
	},

	async bulkTransitionToCancelled(_context: DaemonContext, runIds: NonEmptyArray<string>) {
		const result = await db
			.update(workflowRun)
			.set({
				status: "cancelled",
				revision: sql`${workflowRun.revision} + 1`,
				scheduledAt: null,
				wakeupAt: null,
				timeoutAt: null,
				nextAttemptAt: null,
			})
			.where(and(inArray(workflowRun.id, runIds), inArray(workflowRun.status, NON_TERMINAL_WORKFLOW_RUN_STATUSES)))
			.returning({
				id: workflowRun.id,
				namespaceId: workflowRun.namespaceId,
				attempts: workflowRun.attempts,
				options: workflowRun.options,
				parentWorkflowRunId: workflowRun.parentWorkflowRunId,
			});

		return result;
	},

	async bulkTransitionToStalled(_context: DaemonContext, runIds: NonEmptyArray<string>) {
		const result = await db
			.update(workflowRun)
			.set({
				status: "stalled",
				revision: sql`${workflowRun.revision} + 1`,
				scheduledAt: null,
				wakeupAt: null,
				timeoutAt: null,
				nextAttemptAt: null,
			})
			.where(and(inArray(workflowRun.id, runIds), eq(workflowRun.status, "queued")))
			.returning({ id: workflowRun.id, namespaceId: workflowRun.namespaceId, attempts: workflowRun.attempts });

		return result;
	},

	async bulkReleaseToQueued(_context: DaemonContext, runIds: NonEmptyArray<string>) {
		const result = await db
			.update(workflowRun)
			.set({
				status: "queued",
				revision: sql`${workflowRun.revision} + 1`,
				scheduledAt: null,
				wakeupAt: null,
				timeoutAt: null,
				nextAttemptAt: null,
			})
			.where(and(inArray(workflowRun.id, runIds), eq(workflowRun.status, "running")))
			.returning({ id: workflowRun.id, namespaceId: workflowRun.namespaceId, attempts: workflowRun.attempts });

		return result;
	},

	// Sets the pointer for whatever run ids it is given, with no guard of its own.
	// Call it in the same transaction as the guarded bulk transition that returned these ids:
	// that transition's row locks keep the runs unchanged until this write commits with it.
	async bulkSetLatestStateTransitionId(
		runs: NonEmptyArray<{ filter: { namespaceId: NamespaceId; id: string }; update: { stateTransitionId: string } }>
	): Promise<void> {
		const valueRows = runs.map(({ filter, update }, index) => {
			if (index === 0) {
				return sql`(${filter.namespaceId}::text, ${filter.id}::text, ${update.stateTransitionId}::text)`;
			}
			return sql`(${filter.namespaceId}, ${filter.id}, ${update.stateTransitionId})`;
		});

		await db
			.update(workflowRun)
			.set({
				latestStateTransitionId: sql`v.state_transition_id`,
			})
			.from(sql`(VALUES ${sql.join(valueRows, sql`, `)}) AS v(namespace_id, id, state_transition_id)`)
			.where(sql`${workflowRun.namespaceId} = v.namespace_id AND ${workflowRun.id} = v.id`);
	},

	async getRunCount(namespaceId: NamespaceId, scheduleId: string): Promise<number> {
		const result = await db
			.select({ count: count() })
			.from(workflowRun)
			.where(and(eq(workflowRun.namespaceId, namespaceId), eq(workflowRun.scheduleId, scheduleId)));
		return result[0]?.count ?? 0;
	},

	async getRunCounts(namespaceId: NamespaceId, scheduleIds: NonEmptyArray<string>): Promise<Map<string, number>> {
		const rows = await db
			.select({ scheduleId: workflowRun.scheduleId, count: count() })
			.from(workflowRun)
			.where(and(eq(workflowRun.namespaceId, namespaceId), inArray(workflowRun.scheduleId, scheduleIds)))
			.groupBy(workflowRun.scheduleId);

		const map = new Map<string, number>();
		for (const row of rows) {
			if (row.scheduleId) {
				map.set(row.scheduleId, row.count);
			}
		}
		return map;
	},
});

export type WorkflowRunRepository = ReturnType<typeof createWorkflowRunRepository>;
