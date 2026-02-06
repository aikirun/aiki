import { EVENT_WAIT_STATUSES } from "@aikirun/types/event";
import {
	SCHEDULE_CONFLICT_POLICIES,
	SCHEDULE_OVERLAP_POLICIES,
	SCHEDULE_STATUSES,
	SCHEDULE_TYPES,
} from "@aikirun/types/schedule";
import { SLEEP_STATUSES } from "@aikirun/types/sleep";
import { TASK_CONFLICT_POLICIES, TASK_STATUSES } from "@aikirun/types/task";
import {
	WORKFLOW_RUN_CONFLICT_POLICIES,
	WORKFLOW_RUN_FAILURE_CAUSE,
	WORKFLOW_RUN_SCHEDULED_REASON,
	WORKFLOW_RUN_STATUSES,
} from "@aikirun/types/workflow-run";
import { relations } from "drizzle-orm";
import { foreignKey, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { namespace } from "./auth";

export const scheduleStatusEnum = pgEnum("schedule_status", SCHEDULE_STATUSES);
export const scheduleTypeEnum = pgEnum("schedule_type", SCHEDULE_TYPES);
export const scheduleOverlapPolicyEnum = pgEnum("schedule_overlap_policy", SCHEDULE_OVERLAP_POLICIES);
export const scheduleConflictPolicyEnum = pgEnum("schedule_conflict_policy", SCHEDULE_CONFLICT_POLICIES);

export const workflowRunStatusEnum = pgEnum("workflow_run_status", WORKFLOW_RUN_STATUSES);
export const terminalWorkflowRunStatusEnum = pgEnum("terminal_workflow_run_status", WORKFLOW_RUN_STATUSES);
export const workflowRunConflictPolicyEnum = pgEnum("workflow_run_conflict_policy", WORKFLOW_RUN_CONFLICT_POLICIES);
export const workflowRunScheduledReason = pgEnum("workflow_run_scheduled_reason", WORKFLOW_RUN_SCHEDULED_REASON);
export const workflowRunFailureCause = pgEnum("workflow_run_failure_cause", WORKFLOW_RUN_FAILURE_CAUSE);

export const taskStatusEnum = pgEnum("task_status", TASK_STATUSES);
export const taskConflictPolicyEnum = pgEnum("task_conflict_policy", TASK_CONFLICT_POLICIES);

export const sleepStatusEnum = pgEnum("sleep_status", SLEEP_STATUSES);
export const eventWaitStatusEnum = pgEnum("event_wait_status", EVENT_WAIT_STATUSES);

export const workflow = pgTable(
	"workflow",
	{
		id: text("id").primaryKey(),
		namespaceId: text("namespace_id").notNull(),
		name: text("name").notNull(),
		version: text("version").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		foreignKey({
			name: "fk_workflow_namespace_id",
			columns: [table.namespaceId],
			foreignColumns: [namespace.id],
		}),
		uniqueIndex("uqidx_workflow_namespace_name_version").on(table.namespaceId, table.name, table.version),
	]
);

export const schedule = pgTable(
	"schedule",
	{
		id: text("id").primaryKey(),
		namespaceId: text("namespace_id").notNull(),
		workflowId: text("workflow_id").notNull(),

		status: scheduleStatusEnum("status").notNull(),

		type: scheduleTypeEnum("type").notNull(),
		cronExpression: text("cron_expression"),
		intervalMs: integer("interval_ms"),
		overlapPolicy: scheduleOverlapPolicyEnum("overlap_policy"),

		workflowRunInput: jsonb("workflow_run_input"),

		definitionHash: text("definition_hash").notNull(),

		referenceId: text("reference_id"),
		conflictPolicy: scheduleConflictPolicyEnum("conflict_policy"),

		lastOccurrence: timestamp("last_occurrence", { withTimezone: true }),
		nextRunAt: timestamp("next_run_at", { withTimezone: true }),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
		// TODO: should nextRunAt be first?
		// TODO: how to prevent certain namespaces from starving others
		index("idx_schedule_status_next_run_at").on(table.status, table.nextRunAt),
	]
);

export const workflowRun = pgTable(
	"workflow_run",
	{
		id: text("id").primaryKey(),
		workflowId: text("workflow_id").notNull(),
		scheduleId: text("schedule_id"),
		parentWorkflowRunId: text("parent_workflow_run_id"),

		status: workflowRunStatusEnum("status").notNull(),
		revision: integer("revision").notNull().default(0),
		attempts: integer("attempts").notNull(),

		input: jsonb("input"),
		inputHash: text("input_hash").notNull(),
		options: jsonb("options"),

		referenceId: text("reference_id"),
		conflictPolicy: workflowRunConflictPolicyEnum("conflict_policy"),

		latestStateTransitionId: text("latest_state_transition_id").notNull(),
		scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
		awakeAt: timestamp("awake_at", { withTimezone: true }),
		timeoutAt: timestamp("timeout_at", { withTimezone: true }),
		nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
		// Circular FKs - defined here but deferred to avoid insert order issues
		foreignKey({
			name: "fk_workflow_run_parent_workflow_run_id",
			columns: [table.parentWorkflowRunId],
			foreignColumns: [table.id],
		}),
		uniqueIndex("uqidx_workflow_run_workflow_reference").on(table.workflowId, table.referenceId),
		// TODO: will this help with sorting? index("idx_workflow_run_workflow_created").on(table.workflowId, table.createdAt),

		index("idx_workflow_run_schedule").on(table.scheduleId),
		index("idx_workflow_run_parent_workflow_run").on(table.parentWorkflowRunId),

		// TODO: will adding an index on input hash make conflict resolution faster?

		index("idx_workflow_run_status_scheduled_at").on(table.status, table.scheduledAt),
		index("idx_workflow_run_status_awake_at").on(table.status, table.awakeAt),
		index("idx_workflow_run_status_timeout_at").on(table.status, table.timeoutAt),
		index("idx_workflow_run_status_next_attempt_at").on(table.status, table.nextAttemptAt),
	]
);

export const task = pgTable(
	"task",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		workflowRunId: text("workflow_run_id"),

		status: taskStatusEnum("status").notNull(),
		attempts: integer("attempts").notNull(),

		input: jsonb("input"),
		inputHash: text("input_hash").notNull(),
		options: jsonb("options"),

		referenceId: text("reference_id"),
		conflictPolicy: taskConflictPolicyEnum("conflict_policy"),

		latestStateTransitionId: text("latest_state_transition_id").notNull(),
		nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		foreignKey({
			name: "fk_task_workflow_run_id",
			columns: [table.workflowRunId],
			foreignColumns: [workflowRun.id],
		}),
		uniqueIndex("uqidx_task_workflow_run_reference").on(table.workflowRunId, table.referenceId),
		index("idx_task_status_next_attempt_at").on(table.status, table.nextAttemptAt),
		// TODO: should I add index on created at to help with sorting?
	]
);

export const workflowRunStateTransition = pgTable(
	"workflow_run_state_transition",
	{
		id: text("id").primaryKey(),
		workflowRunId: text("workflow_run_id").notNull(),

		status: workflowRunStatusEnum("status").notNull(),
		attempt: integer("attempt").notNull(),

		scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
		scheduledReason: workflowRunScheduledReason("scheduled_reason"),

		sleepName: text("sleep_name"),
		sleepDurationMs: integer("sleep_duration_ms"),
		awakeAt: timestamp("awake_at", { withTimezone: true }),

		eventName: text("event_name"),
		timeoutAt: timestamp("timeout_at", { withTimezone: true }),

		failureCause: workflowRunFailureCause("failure_cause"),
		taskId: text("task_id"),
		childWorkflowRunId: text("child_workflow_run_id"),
		error: jsonb("error"),
		nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),

		childWorkflowRunStatus: terminalWorkflowRunStatusEnum("child_workflow_run_status"),

		cancelledReason: text("cancelled_reason"),

		output: jsonb("output"),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		foreignKey({
			name: "fk_wtransition_workflow_run_id",
			columns: [table.workflowRunId],
			foreignColumns: [workflowRun.id],
		}),
		foreignKey({
			name: "fk_wtransition_task_id",
			columns: [table.taskId],
			foreignColumns: [task.id],
		}),
		foreignKey({
			name: "fk_wtransition_child_workflow_run_id",
			columns: [table.childWorkflowRunId],
			foreignColumns: [workflowRun.id],
		}),
		index("idx_wtransition_workflow_run_created").on(table.workflowRunId, table.createdAt),
	]
);

export const taskStateTransition = pgTable(
	"task_state_transition",
	{
		id: text("id").primaryKey(),
		taskId: text("task_id").notNull(),
		status: taskStatusEnum("status").notNull(),
		attempt: integer("attempt").notNull(),

		error: jsonb("error"),
		nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),

		output: jsonb("output"),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		foreignKey({
			name: "fk_ttransition_task_id",
			columns: [table.taskId],
			foreignColumns: [task.id],
		}),
		index("idx_ttransition_task_created").on(table.taskId, table.createdAt),
	]
);

export const sleepQueue = pgTable(
	"sleep_queue",
	{
		id: text("id").primaryKey(),
		workflowRunId: text("workflow_run_id").notNull(),

		name: text("name").notNull(),
		status: sleepStatusEnum("status").notNull(),

		awakeAt: timestamp("awake_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		cancelledAt: timestamp("cancelled_at", { withTimezone: true }),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		foreignKey({
			name: "fk_sleep_queue_workflow_run_id",
			columns: [table.workflowRunId],
			foreignColumns: [workflowRun.id],
		}),
		index("idx_sleep_queue_workflow_run_name_created").on(table.workflowRunId, table.name, table.createdAt),
	]
);

export const eventWaitQueue = pgTable(
	"event_wait_queue",
	{
		id: text("id").primaryKey(),
		workflowRunId: text("workflow_run_id").notNull(),

		name: text("name").notNull(),
		status: eventWaitStatusEnum("status").notNull(),
		referenceId: text("reference_id"),

		data: jsonb("data"),

		timeoutAt: timestamp("timeout_at", { withTimezone: true }),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		foreignKey({
			name: "fk_event_wait_queue_workflow_run_id",
			columns: [table.workflowRunId],
			foreignColumns: [workflowRun.id],
		}),
		uniqueIndex("uqidx_event_wait_queue_workflow_run_name_reference").on(
			table.workflowRunId,
			table.name,
			table.referenceId
		),
		index("idx_event_wait_queue_workflow_run_name_created").on(table.workflowRunId, table.name, table.createdAt),
	]
);

// Relations for circular FK references due to TypeScript inference

export const workflowRunRelations = relations(workflowRun, ({ one }) => ({
	parentWorkflowRun: one(workflowRun, {
		fields: [workflowRun.parentWorkflowRunId],
		references: [workflowRun.id],
	}),
	latestStateTransition: one(workflowRunStateTransition, {
		fields: [workflowRun.latestStateTransitionId],
		references: [workflowRunStateTransition.id],
	}),
}));

export const taskRelations = relations(task, ({ one }) => ({
	latestStateTransition: one(taskStateTransition, {
		fields: [task.latestStateTransitionId],
		references: [taskStateTransition.id],
	}),
}));
