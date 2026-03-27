import { EVENT_WAIT_STATUSES } from "@aikirun/types/event";
import {
	SCHEDULE_CONFLICT_POLICIES,
	SCHEDULE_OVERLAP_POLICIES,
	SCHEDULE_STATUSES,
	SCHEDULE_TYPES,
} from "@aikirun/types/schedule";
import { SLEEP_STATUSES } from "@aikirun/types/sleep";
import { STATE_TRANSITION_TYPES } from "@aikirun/types/state-transition";
import { TASK_STATUSES } from "@aikirun/types/task";
import { WORKFLOW_SOURCES } from "@aikirun/types/workflow";
import {
	CHILD_WORKFLOW_RUN_WAIT_STATUSES,
	TERMINAL_WORKFLOW_RUN_STATUSES,
	WORKFLOW_RUN_CONFLICT_POLICIES,
	WORKFLOW_RUN_STATUSES,
} from "@aikirun/types/workflow-run";
import { relations, sql } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { namespace } from "./auth";
import { SQLITE_CURRENT_TIMESTAMP, sqliteJson, sqliteTimestamp } from "./timestamp";
import { WORKFLOW_RUN_OUTBOX_STATUSES } from "../../constants/workflow-run-outbox";

export const workflow = sqliteTable(
	"workflow",
	{
		id: text("id").primaryKey(),
		namespaceId: text("namespace_id").notNull(),
		source: text("source", { enum: WORKFLOW_SOURCES }).notNull().default("user"),
		name: text("name").notNull(),
		versionId: text("version_id").notNull(),
		createdAt: sqliteTimestamp("created_at").notNull().default(SQLITE_CURRENT_TIMESTAMP),
	},
	(table) => [
		foreignKey({
			name: "fk_workflow_namespace_id",
			columns: [table.namespaceId],
			foreignColumns: [namespace.id],
		}),
		uniqueIndex("uqidx_workflow_namespace_source_name_version").on(
			table.namespaceId,
			table.source,
			table.name,
			table.versionId
		),
	]
);

export const schedule = sqliteTable(
	"schedule",
	{
		id: text("id").primaryKey(),
		namespaceId: text("namespace_id").notNull(),
		workflowId: text("workflow_id").notNull(),

		status: text("status", { enum: SCHEDULE_STATUSES }).notNull(),

		type: text("type", { enum: SCHEDULE_TYPES }).notNull(),
		cronExpression: text("cron_expression"),
		intervalMs: integer("interval_ms"),
		overlapPolicy: text("overlap_policy", { enum: SCHEDULE_OVERLAP_POLICIES }),

		workflowRunInput: sqliteJson("workflow_run_input"),
		workflowRunInputHash: text("workflow_run_input_hash").notNull(),

		definitionHash: text("definition_hash").notNull(),

		referenceId: text("reference_id"),
		conflictPolicy: text("conflict_policy", { enum: SCHEDULE_CONFLICT_POLICIES }),

		lastOccurrence: sqliteTimestamp("last_occurrence"),
		nextRunAt: sqliteTimestamp("next_run_at"),

		createdAt: sqliteTimestamp("created_at").notNull().default(SQLITE_CURRENT_TIMESTAMP),
		updatedAt: sqliteTimestamp("updated_at").notNull().default(SQLITE_CURRENT_TIMESTAMP),
	},
	(table) => [
		foreignKey({
			name: "fk_schedule_namespace_id",
			columns: [table.namespaceId],
			foreignColumns: [namespace.id],
		}),
		foreignKey({
			name: "fk_schedule_workflow_id",
			columns: [table.workflowId],
			foreignColumns: [workflow.id],
		}),
		uniqueIndex("uqidx_schedule_namespace_definition").on(table.namespaceId, table.definitionHash),
		uniqueIndex("uqidx_schedule_namespace_reference").on(table.namespaceId, table.referenceId),
		index("idx_schedule_namespace_workflow").on(table.namespaceId, table.workflowId),
		index("idx_schedule_status_next_run_at").on(table.status, table.nextRunAt),
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
		revision: integer("revision").notNull().default(0),
		attempts: integer("attempts").notNull().default(0),

		input: sqliteJson("input"),
		inputHash: text("input_hash").notNull(),
		options: sqliteJson("options"),

		referenceId: text("reference_id"),
		conflictPolicy: text("conflict_policy", { enum: WORKFLOW_RUN_CONFLICT_POLICIES }),

		latestStateTransitionId: text("latest_state_transition_id").notNull(),
		scheduledAt: sqliteTimestamp("scheduled_at"),
		awakeAt: sqliteTimestamp("awake_at"),
		timeoutAt: sqliteTimestamp("timeout_at"),
		nextAttemptAt: sqliteTimestamp("next_attempt_at"),

		createdAt: sqliteTimestamp("created_at").notNull().default(SQLITE_CURRENT_TIMESTAMP),
		updatedAt: sqliteTimestamp("updated_at").notNull().default(SQLITE_CURRENT_TIMESTAMP),
	},
	(table) => [
		foreignKey({
			name: "fk_workflow_run_namespace_id",
			columns: [table.namespaceId],
			foreignColumns: [namespace.id],
		}),
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
		uniqueIndex("uqidx_workflow_run_workflow_reference").on(table.workflowId, table.referenceId),

		index("idx_workflow_run_namespace_id").on(table.namespaceId, table.id),
		index("idx_workflow_run_namespace_status_id").on(table.namespaceId, table.status, table.id),

		index("idx_workflow_run_workflow_id").on(table.workflowId, table.id),
		index("idx_workflow_run_workflow_status_id").on(table.workflowId, table.status, table.id),

		index("idx_workflow_run_schedule").on(table.scheduleId),
		index("idx_workflow_run_parent_workflow_run_status").on(table.parentWorkflowRunId, table.status),

		index("idx_workflow_run_status_scheduled_at").on(table.status, table.scheduledAt),
		index("idx_workflow_run_status_awake_at").on(table.status, table.awakeAt),
		index("idx_workflow_run_status_timeout_at").on(table.status, table.timeoutAt),
		index("idx_workflow_run_status_next_attempt_at").on(table.status, table.nextAttemptAt),
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

		input: sqliteJson("input"),
		inputHash: text("input_hash").notNull(),
		options: sqliteJson("options"),

		latestStateTransitionId: text("latest_state_transition_id").notNull(),
		nextAttemptAt: sqliteTimestamp("next_attempt_at"),

		createdAt: sqliteTimestamp("created_at").notNull().default(SQLITE_CURRENT_TIMESTAMP),
		updatedAt: sqliteTimestamp("updated_at").notNull().default(SQLITE_CURRENT_TIMESTAMP),
	},
	(table) => [
		foreignKey({
			name: "fk_task_workflow_run",
			columns: [table.workflowRunId],
			foreignColumns: [workflowRun.id],
		}),
		index("idx_task_workflow_run_id").on(table.workflowRunId, table.id),
		index("idx_task_workflow_run_status").on(table.workflowRunId, table.status),
		index("idx_task_status_workflow_run_next_attempt_at").on(table.status, table.workflowRunId, table.nextAttemptAt),
	]
);

const workflowRunStatusList = WORKFLOW_RUN_STATUSES.map((s) => `'${s}'`).join(", ");
const taskStatusList = TASK_STATUSES.map((s) => `'${s}'`).join(", ");

export const stateTransition = sqliteTable(
	"state_transition",
	{
		id: text("id").primaryKey(),
		workflowRunId: text("workflow_run_id").notNull(),
		type: text("type", { enum: STATE_TRANSITION_TYPES }).notNull(),
		taskId: text("task_id"),
		status: text("status").notNull(),
		attempt: integer("attempt").notNull(),
		state: sqliteJson("state").notNull(),
		createdAt: sqliteTimestamp("created_at").notNull().default(SQLITE_CURRENT_TIMESTAMP),
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
		index("idx_state_transition_workflow_run_id").on(table.workflowRunId, table.id),
		check(
			"chk_task_state_transition_requires_task_id",
			sql`(${table.type} = 'task' AND ${table.taskId} IS NOT NULL) OR (${table.type} = 'workflow_run' AND ${table.taskId} IS NULL)`
		),
		check(
			"chk_state_transition_status_matches_type",
			sql.raw(
				`(type = 'workflow_run' AND status IN (${workflowRunStatusList}))` +
					` OR (type = 'task' AND status IN (${taskStatusList}))`
			)
		),
	]
);

export const sleepQueue = sqliteTable(
	"sleep_queue",
	{
		id: text("id").primaryKey(),
		workflowRunId: text("workflow_run_id").notNull(),

		name: text("name").notNull(),
		status: text("status", { enum: SLEEP_STATUSES }).notNull(),

		awakeAt: sqliteTimestamp("awake_at").notNull(),
		completedAt: sqliteTimestamp("completed_at"),
		cancelledAt: sqliteTimestamp("cancelled_at"),

		createdAt: sqliteTimestamp("created_at").notNull().default(SQLITE_CURRENT_TIMESTAMP),
	},
	(table) => [
		foreignKey({
			name: "fk_sleep_queue_workflow_run",
			columns: [table.workflowRunId],
			foreignColumns: [workflowRun.id],
		}),
		uniqueIndex("uqidx_sleep_queue_one_active_per_run")
			.on(table.workflowRunId)
			.where(sql`${table.status} = 'sleeping'`),
		index("idx_sleep_queue_workflow_run_id").on(table.workflowRunId, table.id),
		check(
			"chk_sleep_queue_completed_requires_completed_at",
			sql`${table.status} != 'completed' OR ${table.completedAt} IS NOT NULL`
		),
		check(
			"chk_sleep_queue_cancelled_requires_cancelled_at",
			sql`${table.status} != 'cancelled' OR ${table.cancelledAt} IS NOT NULL`
		),
	]
);

export const eventWaitQueue = sqliteTable(
	"event_wait_queue",
	{
		id: text("id").primaryKey(),
		workflowRunId: text("workflow_run_id").notNull(),

		name: text("name").notNull(),
		status: text("status", { enum: EVENT_WAIT_STATUSES }).notNull(),
		referenceId: text("reference_id"),

		data: sqliteJson("data"),

		timedOutAt: sqliteTimestamp("timed_out_at"),

		createdAt: sqliteTimestamp("created_at").notNull().default(SQLITE_CURRENT_TIMESTAMP),
	},
	(table) => [
		foreignKey({
			name: "fk_event_wait_queue_workflow_run",
			columns: [table.workflowRunId],
			foreignColumns: [workflowRun.id],
		}),
		uniqueIndex("uqidx_event_wait_queue_workflow_run_name_reference").on(
			table.workflowRunId,
			table.name,
			table.referenceId
		),
		index("idx_event_wait_queue_workflow_run_id").on(table.workflowRunId, table.id),
		check(
			"chk_event_wait_queue_timeout_requires_timed_out_at",
			sql`${table.status} != 'timeout' OR ${table.timedOutAt} IS NOT NULL`
		),
	]
);

export const childWorkflowRunWaitQueue = sqliteTable(
	"child_workflow_run_wait_queue",
	{
		id: text("id").primaryKey(),
		parentWorkflowRunId: text("parent_workflow_run_id").notNull(),
		childWorkflowRunId: text("child_workflow_run_id").notNull(),
		childWorkflowRunStatus: text("child_workflow_run_status", { enum: TERMINAL_WORKFLOW_RUN_STATUSES }).notNull(),

		status: text("status", { enum: CHILD_WORKFLOW_RUN_WAIT_STATUSES }).notNull(),
		completedAt: sqliteTimestamp("completed_at"),
		timedOutAt: sqliteTimestamp("timed_out_at"),

		childWorkflowRunStateTransitionId: text("child_workflow_run_state_transition_id"),

		createdAt: sqliteTimestamp("created_at").notNull().default(SQLITE_CURRENT_TIMESTAMP),
	},
	(table) => [
		foreignKey({
			name: "fk_child_workflow_run_wait_queue_parent",
			columns: [table.parentWorkflowRunId],
			foreignColumns: [workflowRun.id],
		}),
		foreignKey({
			name: "fk_child_workflow_run_wait_queue_child",
			columns: [table.childWorkflowRunId],
			foreignColumns: [workflowRun.id],
		}),
		foreignKey({
			name: "fk_child_workflow_run_wait_queue_state_transition",
			columns: [table.childWorkflowRunStateTransitionId],
			foreignColumns: [stateTransition.id],
		}),
		index("idx_child_workflow_run_wait_queue_parent_id").on(table.parentWorkflowRunId, table.id),
		check(
			"chk_child_workflow_run_wait_completed_invariants",
			sql`${table.status} != 'completed' OR (${table.completedAt} IS NOT NULL AND ${table.childWorkflowRunStateTransitionId} IS NOT NULL)`
		),
		check(
			"chk_child_workflow_run_wait_timeout_requires_timed_out_at",
			sql`${table.status} != 'timeout' OR ${table.timedOutAt} IS NOT NULL`
		),
	]
);

export const workflowRunOutbox = sqliteTable(
	"workflow_run_outbox",
	{
		id: text("id").primaryKey(),
		namespaceId: text("namespace_id").notNull(),
		workflowRunId: text("workflow_run_id").notNull(),
		workflowName: text("workflow_name").notNull(),
		workflowVersionId: text("workflow_version_id").notNull(),
		shard: text("shard"),

		status: text("status", { enum: WORKFLOW_RUN_OUTBOX_STATUSES }).notNull(),

		createdAt: sqliteTimestamp("created_at").notNull().default(SQLITE_CURRENT_TIMESTAMP),
		updatedAt: sqliteTimestamp("updated_at").notNull().default(SQLITE_CURRENT_TIMESTAMP),
	},
	(table) => [
		uniqueIndex("uqidx_workflow_run_outbox_workflow_run_id").on(table.workflowRunId),
		index("idx_workflow_run_outbox_publish").on(
			table.namespaceId,
			table.status,
			table.createdAt,
			table.workflowName,
			table.workflowVersionId,
			table.shard
		),
		index("idx_workflow_run_outbox_claim_stale").on(
			table.namespaceId,
			table.status,
			table.updatedAt,
			table.workflowName,
			table.workflowVersionId,
			table.shard
		),
		index("idx_workflow_run_outbox_status_created").on(table.status, table.createdAt),
		index("idx_workflow_run_outbox_status_updated").on(table.status, table.updatedAt),
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
