import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { OpaquePayload } from "@aikirun/types/payload";
import { SCHEDULE_OVERLAP_POLICIES, SCHEDULE_STATUSES, SCHEDULE_TYPES } from "@aikirun/types/schedule";
import { WORKFLOW_SOURCES } from "@aikirun/types/workflow";
import {
	EVENT_WAIT_STATUSES,
	SLEEP_STATUSES,
	TERMINAL_WORKFLOW_RUN_STATUSES,
	WORKFLOW_RUN_STATUSES,
	type WorkflowRunOptions,
} from "@aikirun/types/workflow/run";
import { TASK_STATUSES, type TaskStartOptions } from "@aikirun/types/workflow/task";
import { relations, type SQL, sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	real,
	type SQLiteColumn,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { timestampMs } from "./timestamp";
import { CHILD_WORKFLOW_RUN_WAIT_STATUSES } from "../constants/child-workflow-run-wait";
import { STATE_TRANSITION_TYPES } from "../constants/state-transition";
import { WORKFLOW_RUN_OUTBOX_STATUSES } from "../constants/workflow-run-outbox";

const NOW_MS = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

const boolean = (name: string) => integer(name, { mode: "boolean" });

// The update statement sets updated_at: a trigger runs only after the update, too late for
// RETURNING to see it. SQLite runs in this process, so this is the clock the created_at default reads.
const updatedAtMs = () =>
	timestampMs("updated_at")
		.notNull()
		.default(NOW_MS)
		.$onUpdate(() => Date.now() as TimestampMs);

// SQLite has no enum type, so each enum column carries a CHECK of its values.
function isOneOf(column: SQLiteColumn | SQL, values: readonly string[]): SQL {
	return sql`${column} IN (${sql.raw(values.map((value) => `'${value}'`).join(", "))})`;
}

export const workflow = sqliteTable(
	"workflow",
	{
		id: text("id").primaryKey(),
		namespaceId: text("namespace_id").notNull(),
		source: text("source", { enum: WORKFLOW_SOURCES }).notNull(),
		name: text("name").notNull(),
		versionId: text("version_id").notNull(),
		createdAt: timestampMs("created_at").notNull().default(NOW_MS),
	},
	(table) => [
		uniqueIndex("uqidx_workflow_namespace_source_name_version").on(
			table.namespaceId,
			table.source,
			table.name,
			table.versionId
		),
		check("chk_workflow_source", isOneOf(table.source, WORKFLOW_SOURCES)),
	]
);

export const schedule = sqliteTable(
	"schedule",
	{
		id: text("id").primaryKey(),
		namespaceId: text("namespace_id").notNull(),
		workflowId: text("workflow_id").notNull(),

		status: text("status", { enum: SCHEDULE_STATUSES }).notNull(),
		clientHasherApplied: boolean("client_hasher_applied").notNull(),
		clientCodecApplied: boolean("client_codec_applied").notNull(),
		revision: integer("revision").notNull().default(0),

		type: text("type", { enum: SCHEDULE_TYPES }).notNull(),
		cronExpression: text("cron_expression"),
		cronTimezone: text("cron_timezone"),
		intervalMs: integer("interval_ms"),
		overlapPolicy: text("overlap_policy", { enum: SCHEDULE_OVERLAP_POLICIES }),

		workflowRunInput: text("workflow_run_input", { mode: "json" }).$type<OpaquePayload>(),
		workflowRunInputHash: text("workflow_run_input_hash").notNull(),

		definitionHash: text("definition_hash").notNull(),

		referenceId: text("reference_id"),

		workflowRunOptions: text("workflow_run_options", { mode: "json" }).$type<WorkflowRunOptions>(),

		lastOccurrence: timestampMs("last_occurrence"),
		nextRunAt: timestampMs("next_run_at").notNull(),
		latestStateTransitionId: text("latest_state_transition_id").notNull(),

		createdAt: timestampMs("created_at").notNull().default(NOW_MS),
		updatedAt: updatedAtMs(),
	},
	(table) => [
		foreignKey({
			name: "fk_schedule_workflow_id",
			columns: [table.workflowId],
			foreignColumns: [workflow.id],
		}),
		uniqueIndex("uqidx_schedule_namespace_definition").on(table.namespaceId, table.definitionHash),
		uniqueIndex("uqidx_schedule_namespace_reference").on(table.namespaceId, table.referenceId),
		index("idx_schedule_namespace_workflow").on(table.namespaceId, table.workflowId),
		index("idx_schedule_due_active").on(table.nextRunAt, table.id).where(sql`${table.status} = 'active'`),
		check("chk_schedule_status", isOneOf(table.status, SCHEDULE_STATUSES)),
		check("chk_schedule_type", isOneOf(table.type, SCHEDULE_TYPES)),
		check(
			"chk_schedule_overlap_policy",
			sql`${table.overlapPolicy} IS NULL OR ${isOneOf(table.overlapPolicy, SCHEDULE_OVERLAP_POLICIES)}`
		),
		check(
			"chk_schedule_spec_matches_type",
			sql`(${table.type} = 'cron' AND ${table.cronExpression} IS NOT NULL AND ${table.intervalMs} IS NULL) OR (${table.type} = 'interval' AND ${table.intervalMs} > 0 AND ${table.cronExpression} IS NULL AND ${table.cronTimezone} IS NULL)`
		),
	]
);

export const workflowRun = sqliteTable(
	"workflow_run",
	{
		id: text("id").primaryKey(),
		namespaceId: text("namespace_id").notNull(),
		workflowId: text("workflow_id").notNull(),
		scheduleId: text("schedule_id"),
		parentWorkflowRunId: text("parent_workflow_run_id"),

		status: text("status", { enum: WORKFLOW_RUN_STATUSES }).notNull(),
		clientHasherApplied: boolean("client_hasher_applied").notNull(),
		clientCodecApplied: boolean("client_codec_applied").notNull(),
		revision: integer("revision").notNull().default(0),
		signalSequence: integer("signal_sequence").notNull().default(0),
		attempts: integer("attempts").notNull().default(1),

		input: text("input", { mode: "json" }).$type<OpaquePayload>(),
		inputHash: text("input_hash").notNull(),
		options: text("options", { mode: "json" }).$type<WorkflowRunOptions>(),

		referenceId: text("reference_id"),

		latestStateTransitionId: text("latest_state_transition_id").notNull(),
		scheduledAt: timestampMs("scheduled_at"),
		wakeupAt: timestampMs("wakeup_at"),
		timeoutAt: timestampMs("timeout_at"),
		nextAttemptAt: timestampMs("next_attempt_at"),

		createdAt: timestampMs("created_at").notNull().default(NOW_MS),
		updatedAt: updatedAtMs(),
	},
	(table) => [
		foreignKey({
			name: "fk_workflow_run_workflow_id",
			columns: [table.workflowId],
			foreignColumns: [workflow.id],
		}),
		foreignKey({
			name: "fk_workflow_run_schedule_id",
			columns: [table.scheduleId],
			foreignColumns: [schedule.id],
		}),
		foreignKey({
			name: "fk_workflow_run_parent_workflow_run",
			columns: [table.parentWorkflowRunId],
			foreignColumns: [table.id],
		}),
		uniqueIndex("uqidx_workflow_run_workflow_reference")
			.on(table.workflowId, table.referenceId)
			.where(sql`${table.referenceId} IS NOT NULL`),

		index("idx_workflow_run_namespace_id").on(table.namespaceId, table.id),
		index("idx_workflow_run_namespace_status_id").on(table.namespaceId, table.status, table.id),

		index("idx_workflow_run_workflow_id").on(table.workflowId, table.id),
		index("idx_workflow_run_workflow_status_id").on(table.workflowId, table.status, table.id),

		index("idx_workflow_run_schedule_namespace")
			.on(table.scheduleId, table.namespaceId)
			.where(sql`${table.scheduleId} IS NOT NULL`),
		index("idx_workflow_run_parent_workflow_run_status")
			.on(table.parentWorkflowRunId, table.status)
			.where(sql`${table.parentWorkflowRunId} IS NOT NULL`),

		index("idx_workflow_run_due_scheduled").on(table.scheduledAt, table.id).where(sql`${table.status} = 'scheduled'`),
		index("idx_workflow_run_due_sleeping").on(table.wakeupAt, table.id).where(sql`${table.status} = 'sleeping'`),
		index("idx_workflow_run_due_awaiting_event")
			.on(table.timeoutAt, table.id)
			.where(sql`${table.status} = 'awaiting_event'`),
		index("idx_workflow_run_due_awaiting_child_workflow")
			.on(table.timeoutAt, table.id)
			.where(sql`${table.status} = 'awaiting_child_workflow'`),
		index("idx_workflow_run_due_awaiting_retry")
			.on(table.nextAttemptAt, table.id)
			.where(sql`${table.status} = 'awaiting_retry'`),
		index("idx_workflow_run_due_awaiting_task_retry")
			.on(table.nextAttemptAt, table.id)
			.where(sql`${table.status} = 'awaiting_task_retry'`),

		check("chk_workflow_run_status", isOneOf(table.status, WORKFLOW_RUN_STATUSES)),
	]
);

export const task = sqliteTable(
	"task",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		workflowRunId: text("workflow_run_id").notNull(),

		status: text("status", { enum: TASK_STATUSES }).notNull(),
		attempts: integer("attempts").notNull(),

		input: text("input", { mode: "json" }).$type<OpaquePayload>(),
		inputHash: text("input_hash").notNull(),
		options: text("options", { mode: "json" }).$type<TaskStartOptions>(),

		latestStateTransitionId: text("latest_state_transition_id").notNull(),
		nextAttemptAt: timestampMs("next_attempt_at"),

		createdAt: timestampMs("created_at").notNull().default(NOW_MS),
		updatedAt: updatedAtMs(),
	},
	(table) => [
		foreignKey({
			name: "fk_task_workflow_run",
			columns: [table.workflowRunId],
			foreignColumns: [workflowRun.id],
		}),
		index("idx_task_workflow_run_id").on(table.workflowRunId, table.id),
		index("idx_task_workflow_run_status").on(table.workflowRunId, table.status),
		check("chk_task_status", isOneOf(table.status, TASK_STATUSES)),
	]
);

/**
 * Sorts state transition types in declaration order. Text sorts `task` before `workflow_run`,
 * but within one revision the run's transition sorts before the task transitions stamped with
 * the revision it produced.
 */
export function stateTransitionTypeOrder(type: SQLiteColumn): SQL {
	return sql`(CASE ${type} ${sql.raw(STATE_TRANSITION_TYPES.map((value, position) => `WHEN '${value}' THEN ${position}`).join(" "))} END)`;
}

export const stateTransition = sqliteTable(
	"state_transition",
	{
		id: text("id").primaryKey(),
		workflowRunId: text("workflow_run_id"),
		type: text("type", { enum: STATE_TRANSITION_TYPES }).notNull(),
		taskId: text("task_id"),
		scheduleId: text("schedule_id"),
		status: text("status")
			.notNull()
			.generatedAlwaysAs((): SQL => sql`json_extract(${stateTransition.state}, '$.status')`, { mode: "stored" }),
		attempt: integer("attempt"),
		revision: integer("revision").notNull(),
		taskSequence: integer("task_sequence"),
		state: text("state", { mode: "json" }).notNull(),
		createdAt: timestampMs("created_at").notNull().default(NOW_MS),
	},
	(table) => [
		foreignKey({
			name: "fk_state_transition_workflow_run",
			columns: [table.workflowRunId],
			foreignColumns: [workflowRun.id],
		}),
		foreignKey({
			name: "fk_state_transition_task",
			columns: [table.taskId],
			foreignColumns: [task.id],
		}),
		foreignKey({
			name: "fk_state_transition_schedule",
			columns: [table.scheduleId],
			foreignColumns: [schedule.id],
		}),
		index("idx_state_transition_workflow_run_id")
			.on(table.workflowRunId, table.revision, stateTransitionTypeOrder(table.type), table.taskSequence, table.id)
			.where(sql`${table.workflowRunId} IS NOT NULL`),
		index("idx_state_transition_schedule_id")
			.on(table.scheduleId, table.revision, table.id)
			.where(sql`${table.scheduleId} IS NOT NULL`),
		check("chk_state_transition_type", isOneOf(table.type, STATE_TRANSITION_TYPES)),
		check(
			"chk_state_transition_columns_match_type",
			sql`(${table.type} = 'workflow_run' AND ${table.workflowRunId} IS NOT NULL AND ${table.attempt} IS NOT NULL AND ${table.taskId} IS NULL AND ${table.scheduleId} IS NULL AND ${table.taskSequence} IS NULL) OR (${table.type} = 'task' AND ${table.workflowRunId} IS NOT NULL AND ${table.attempt} IS NOT NULL AND ${table.taskId} IS NOT NULL AND ${table.scheduleId} IS NULL AND ${table.taskSequence} IS NOT NULL AND ${table.taskSequence} >= 0) OR (${table.type} = 'schedule' AND ${table.scheduleId} IS NOT NULL AND ${table.workflowRunId} IS NULL AND ${table.attempt} IS NULL AND ${table.taskId} IS NULL AND ${table.taskSequence} IS NULL)`
		),
		check(
			"chk_state_transition_status_matches_type",
			sql`(${table.type} = 'workflow_run' AND ${isOneOf(table.status, WORKFLOW_RUN_STATUSES)}) OR (${table.type} = 'task' AND ${isOneOf(table.status, TASK_STATUSES)}) OR (${table.type} = 'schedule' AND ${isOneOf(table.status, SCHEDULE_STATUSES)})`
		),
	]
);

export const sleep = sqliteTable(
	"sleep",
	{
		id: text("id").primaryKey(),
		workflowRunId: text("workflow_run_id").notNull(),

		name: text("name").notNull(),
		status: text("status", { enum: SLEEP_STATUSES }).notNull(),

		wakeupAt: timestampMs("wakeup_at").notNull(),
		completedAt: timestampMs("completed_at"),
		cancelledAt: timestampMs("cancelled_at"),

		createdAt: timestampMs("created_at").notNull().default(NOW_MS),
	},
	(table) => [
		foreignKey({
			name: "fk_sleep_workflow_run",
			columns: [table.workflowRunId],
			foreignColumns: [workflowRun.id],
		}),
		uniqueIndex("uqidx_sleep_one_active_per_run").on(table.workflowRunId).where(sql`${table.status} = 'sleeping'`),
		index("idx_sleep_workflow_run_id").on(table.workflowRunId, table.id),
		check("chk_sleep_status", isOneOf(table.status, SLEEP_STATUSES)),
		check(
			"chk_sleep_completed_requires_completed_at",
			sql`${table.status} != 'completed' OR ${table.completedAt} IS NOT NULL`
		),
		check(
			"chk_sleep_cancelled_requires_cancelled_at",
			sql`${table.status} != 'cancelled' OR ${table.cancelledAt} IS NOT NULL`
		),
	]
);

export const eventWait = sqliteTable(
	"event_wait",
	{
		id: text("id").primaryKey(),
		workflowRunId: text("workflow_run_id").notNull(),

		name: text("name").notNull(),
		status: text("status", { enum: EVENT_WAIT_STATUSES }).notNull(),
		referenceId: text("reference_id"),

		signalSequence: integer("signal_sequence").notNull(),

		data: text("data", { mode: "json" }).$type<OpaquePayload>(),
		clientCodecApplied: boolean("client_codec_applied").notNull(),

		timedOutAt: timestampMs("timed_out_at"),

		createdAt: timestampMs("created_at").notNull().default(NOW_MS),
	},
	(table) => [
		foreignKey({
			name: "fk_event_wait_workflow_run",
			columns: [table.workflowRunId],
			foreignColumns: [workflowRun.id],
		}),
		uniqueIndex("uqidx_event_wait_workflow_run_name_reference").on(table.workflowRunId, table.name, table.referenceId),
		index("idx_event_wait_workflow_run_signal_sequence_id").on(table.workflowRunId, table.signalSequence, table.id),
		check("chk_event_wait_status", isOneOf(table.status, EVENT_WAIT_STATUSES)),
		check(
			"chk_event_wait_timeout_requires_timed_out_at",
			sql`${table.status} != 'timeout' OR ${table.timedOutAt} IS NOT NULL`
		),
		check(
			"chk_event_wait_timeout_not_codec_applied",
			sql`${table.status} != 'timeout' OR ${table.clientCodecApplied} = false`
		),
	]
);

export const childWorkflowRunWait = sqliteTable(
	"child_workflow_run_wait",
	{
		id: text("id").primaryKey(),
		parentWorkflowRunId: text("parent_workflow_run_id").notNull(),
		childWorkflowRunId: text("child_workflow_run_id").notNull(),
		childWorkflowRunStatus: text("child_workflow_run_status", { enum: TERMINAL_WORKFLOW_RUN_STATUSES }),

		status: text("status", { enum: CHILD_WORKFLOW_RUN_WAIT_STATUSES }).notNull(),
		completedAt: timestampMs("completed_at"),
		timedOutAt: timestampMs("timed_out_at"),

		childWorkflowRunStateTransitionId: text("child_workflow_run_state_transition_id"),

		signalSequence: integer("signal_sequence"),

		createdAt: timestampMs("created_at").notNull().default(NOW_MS),
	},
	(table) => [
		foreignKey({
			name: "fk_child_workflow_run_wait_parent",
			columns: [table.parentWorkflowRunId],
			foreignColumns: [workflowRun.id],
		}),
		foreignKey({
			name: "fk_child_workflow_run_wait_child",
			columns: [table.childWorkflowRunId],
			foreignColumns: [workflowRun.id],
		}),
		foreignKey({
			name: "fk_child_workflow_run_wait_state_transition",
			columns: [table.childWorkflowRunStateTransitionId],
			foreignColumns: [stateTransition.id],
		}),
		index("idx_child_workflow_run_wait_parent_id").on(table.parentWorkflowRunId, table.id),
		check("chk_child_workflow_run_wait_status", isOneOf(table.status, CHILD_WORKFLOW_RUN_WAIT_STATUSES)),
		check(
			"chk_child_workflow_run_wait_child_workflow_run_status",
			sql`${table.childWorkflowRunStatus} IS NULL OR ${isOneOf(table.childWorkflowRunStatus, TERMINAL_WORKFLOW_RUN_STATUSES)}`
		),
		check(
			"chk_child_workflow_run_wait_completed_invariants",
			sql`${table.status} != 'completed' OR (${table.completedAt} IS NOT NULL AND ${table.childWorkflowRunStateTransitionId} IS NOT NULL AND ${table.childWorkflowRunStatus} IS NOT NULL AND ${table.signalSequence} IS NOT NULL)`
		),
		check(
			"chk_child_workflow_run_wait_timeout_invariants",
			sql`${table.status} != 'timeout' OR (${table.timedOutAt} IS NOT NULL AND ${table.childWorkflowRunStatus} IS NULL AND ${table.childWorkflowRunStateTransitionId} IS NULL AND ${table.signalSequence} IS NULL)`
		),
	]
);

export const workflowRunOutbox = sqliteTable(
	"workflow_run_outbox",
	{
		id: text("id").primaryKey(),
		namespaceId: text("namespace_id").notNull(),
		workflowRunId: text("workflow_run_id").notNull(),
		workflowSource: text("workflow_source", { enum: WORKFLOW_SOURCES }).notNull(),
		workflowName: text("workflow_name").notNull(),
		workflowVersionId: text("workflow_version_id").notNull(),
		pool: text("pool"),
		rank: real("rank").notNull(),

		status: text("status", { enum: WORKFLOW_RUN_OUTBOX_STATUSES }).notNull(),

		claimedAt: timestampMs("claimed_at"),
		firstPublishedAt: timestampMs("first_published_at"),
		lastPublishedAt: timestampMs("last_published_at"),
		nextPublishAttemptRank: real("next_publish_attempt_rank").notNull(),

		dispatchAttempts: integer("dispatch_attempts").notNull().default(0),

		createdAt: timestampMs("created_at").notNull().default(NOW_MS),
		updatedAt: updatedAtMs(),
	},
	(table) => [
		uniqueIndex("uqidx_workflow_run_outbox_workflow_run_id").on(table.workflowRunId),

		index("idx_workflow_run_outbox_claim_pending")
			.on(
				table.namespaceId,
				table.workflowSource,
				table.workflowName,
				table.workflowVersionId,
				table.pool,
				table.rank,
				table.id
			)
			.where(sql`${table.status} = 'pending'`),

		index("idx_workflow_run_outbox_list_pending")
			.on(table.nextPublishAttemptRank, table.id)
			.where(sql`${table.status} = 'pending'`),
		index("idx_workflow_run_outbox_list_published")
			.on(table.nextPublishAttemptRank, table.id)
			.where(sql`${table.status} = 'published'`),
		index("idx_workflow_run_outbox_list_claimed").on(table.claimedAt, table.id).where(sql`${table.status} = 'claimed'`),

		index("idx_workflow_run_outbox_stall_undeliverable")
			.on(table.id)
			.where(sql`${table.status} IN ('pending', 'published')`),

		check("chk_workflow_run_outbox_workflow_source", isOneOf(table.workflowSource, WORKFLOW_SOURCES)),
		check("chk_workflow_run_outbox_status", isOneOf(table.status, WORKFLOW_RUN_OUTBOX_STATUSES)),
		check(
			"chk_workflow_run_outbox_published_requires_first_published_at",
			sql`${table.status} != 'published' OR ${table.firstPublishedAt} IS NOT NULL`
		),
		check(
			"chk_workflow_run_outbox_claimed_requires_claimed_at",
			sql`${table.status} != 'claimed' OR ${table.claimedAt} IS NOT NULL`
		),
	]
);

export const workflowRunRelations = relations(workflowRun, ({ one }) => ({
	parentWorkflowRun: one(workflowRun, {
		fields: [workflowRun.parentWorkflowRunId],
		references: [workflowRun.id],
	}),
	latestStateTransition: one(stateTransition, {
		fields: [workflowRun.latestStateTransitionId],
		references: [stateTransition.id],
	}),
}));

export const taskRelations = relations(task, ({ one }) => ({
	latestStateTransition: one(stateTransition, {
		fields: [task.latestStateTransitionId],
		references: [stateTransition.id],
	}),
}));
