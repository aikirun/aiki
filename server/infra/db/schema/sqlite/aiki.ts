/**
 * SQLite schema for Aiki workflows
 * Translated from server/infra/db/schema/pg/aiki.ts
 */

import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { namespace } from "./auth";

// Note: SQLite doesn't have ENUM types. We store as text and validate at application layer.
// The WORKFLOW_SOURCES, WORKFLOW_RUN_STATUSES, etc. constants from @aikirun/types
// are used for validation in the application code.

export const workflow = sqliteTable(
	"workflow",
	{
		id: text("id").primaryKey(),
		namespaceId: text("namespace_id")
			.notNull()
			.references(() => namespace.id),
		source: text("source").notNull().default("user"), // workflow_source enum values
		name: text("name").notNull(),
		versionId: text("version_id").notNull(),
		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
	},
	(table) => [
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
		namespaceId: text("namespace_id")
			.notNull()
			.references(() => namespace.id),
		workflowId: text("workflow_id")
			.notNull()
			.references(() => workflow.id),

		status: text("status").notNull(), // schedule_status enum
		type: text("type").notNull(), // schedule_type enum
		cronExpression: text("cron_expression"),
		intervalMs: integer("interval_ms"),
		overlapPolicy: text("overlap_policy"), // schedule_overlap_policy enum

		workflowRunInput: text("workflow_run_input", { mode: "json" }),
		workflowRunInputHash: text("workflow_run_input_hash").notNull(),

		definitionHash: text("definition_hash").notNull(),

		referenceId: text("reference_id"),
		conflictPolicy: text("conflict_policy"), // schedule_conflict_policy enum

		lastOccurrence: text("last_occurrence"),
		nextRunAt: text("next_run_at"),

		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
		updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
	},
	(table) => [
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
		namespaceId: text("namespace_id")
			.notNull()
			.references(() => namespace.id),
		workflowId: text("workflow_id")
			.notNull()
			.references(() => workflow.id),
		scheduleId: text("schedule_id").references(() => schedule.id),
		parentWorkflowRunId: text("parent_workflow_run_id"), // Self-referential FK handled via relations

		status: text("status").notNull(), // workflow_run_status enum
		revision: integer("revision").notNull().default(0),
		attempts: integer("attempts").notNull().default(0),

		input: text("input", { mode: "json" }),
		inputHash: text("input_hash").notNull(),
		options: text("options", { mode: "json" }),

		referenceId: text("reference_id"),
		conflictPolicy: text("conflict_policy"), // workflow_run_conflict_policy enum

		latestStateTransitionId: text("latest_state_transition_id").notNull(),
		scheduledAt: text("scheduled_at"),
		awakeAt: text("awake_at"),
		timeoutAt: text("timeout_at"),
		nextAttemptAt: text("next_attempt_at"),

		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
		updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
	},
	(table) => [
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
		workflowRunId: text("workflow_run_id")
			.notNull()
			.references(() => workflowRun.id),

		status: text("status").notNull(), // task_status enum
		attempts: integer("attempts").notNull(),

		input: text("input", { mode: "json" }),
		inputHash: text("input_hash").notNull(),
		options: text("options", { mode: "json" }),

		latestStateTransitionId: text("latest_state_transition_id").notNull(),
		nextAttemptAt: text("next_attempt_at"),

		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
		updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
	},
	(table) => [
		index("idx_task_workflow_run_id").on(table.workflowRunId, table.id),
		index("idx_task_workflow_run_status").on(table.workflowRunId, table.status),
		index("idx_task_status_workflow_run_next_attempt_at").on(table.status, table.workflowRunId, table.nextAttemptAt),
	]
);

export const stateTransition = sqliteTable(
	"state_transition",
	{
		id: text("id").primaryKey(),
		workflowRunId: text("workflow_run_id")
			.notNull()
			.references(() => workflowRun.id),
		type: text("type").notNull(), // state_transition_type enum
		taskId: text("task_id").references(() => task.id),
		status: text("status").notNull(),
		attempt: integer("attempt").notNull(),
		state: text("state", { mode: "json" }).notNull(),
		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
	},
	(table) => [
		index("idx_state_transition_workflow_run_id").on(table.workflowRunId, table.id),
		// Note: CHECK constraints would need to be added via raw SQL or migrations
		// The PG schema has complex CHECK constraints that validate enum consistency
	]
);

export const sleepQueue = sqliteTable(
	"sleep_queue",
	{
		id: text("id").primaryKey(),
		workflowRunId: text("workflow_run_id")
			.notNull()
			.references(() => workflowRun.id),

		name: text("name").notNull(),
		status: text("status").notNull(), // sleep_status enum

		awakeAt: text("awake_at").notNull(),
		completedAt: text("completed_at"),
		cancelledAt: text("cancelled_at"),

		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
	},
	(table) => [
		// Partial unique index - only one active sleep per workflow run
		// SQLite supports this syntax
		uniqueIndex("uqidx_sleep_queue_one_active_per_run")
			.on(table.workflowRunId)
			.where(sql`${table.status} = 'sleeping'`),
		index("idx_sleep_queue_workflow_run_id").on(table.workflowRunId, table.id),
	]
);

export const eventWaitQueue = sqliteTable(
	"event_wait_queue",
	{
		id: text("id").primaryKey(),
		workflowRunId: text("workflow_run_id")
			.notNull()
			.references(() => workflowRun.id),

		name: text("name").notNull(),
		status: text("status").notNull(), // event_wait_status enum
		referenceId: text("reference_id"),

		data: text("data", { mode: "json" }),

		timedOutAt: text("timed_out_at"),

		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
	},
	(table) => [
		uniqueIndex("uqidx_event_wait_queue_workflow_run_name_reference").on(
			table.workflowRunId,
			table.name,
			table.referenceId
		),
		index("idx_event_wait_queue_workflow_run_id").on(table.workflowRunId, table.id),
	]
);

export const childWorkflowRunWaitQueue = sqliteTable(
	"child_workflow_run_wait_queue",
	{
		id: text("id").primaryKey(),
		parentWorkflowRunId: text("parent_workflow_run_id")
			.notNull()
			.references(() => workflowRun.id),
		childWorkflowRunId: text("child_workflow_run_id")
			.notNull()
			.references(() => workflowRun.id),
		childWorkflowRunStatus: text("child_workflow_run_status").notNull(), // terminal_workflow_run_status enum

		status: text("status").notNull(), // child_workflow_run_wait_status enum
		completedAt: text("completed_at"),
		timedOutAt: text("timed_out_at"),

		childWorkflowRunStateTransitionId: text("child_workflow_run_state_transition_id").references(
			() => stateTransition.id
		),

		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
	},
	(table) => [index("idx_child_workflow_run_wait_queue_parent_id").on(table.parentWorkflowRunId, table.id)]
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

		status: text("status").notNull(), // workflow_run_outbox_status enum

		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
		updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
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

// Relations for circular FK references (same as PG schema)
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
