import { SCHEDULE_OVERLAP_POLICIES, SCHEDULE_STATUSES, SCHEDULE_TYPES } from "@aikirun/types/schedule";
import { WORKFLOW_SOURCES } from "@aikirun/types/workflow";
import {
	EVENT_WAIT_STATUSES,
	SLEEP_STATUSES,
	TERMINAL_WORKFLOW_RUN_STATUSES,
	WORKFLOW_RUN_STATUSES,
	type WorkflowRunOptions,
} from "@aikirun/types/workflow/run";
import { STATE_TRANSITION_TYPES } from "@aikirun/types/workflow/state-transition";
import { TASK_STATUSES, type TaskStartOptions } from "@aikirun/types/workflow/task";
import { relations, sql } from "drizzle-orm";
import {
	check,
	doublePrecision,
	foreignKey,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { timestampMs } from "./timestamp";
import { CHILD_WORKFLOW_RUN_WAIT_STATUSES } from "../constants/child-workflow-run-wait";
import { WORKFLOW_RUN_OUTBOX_STATUSES } from "../constants/workflow-run-outbox";

export const workflowSourceEnum = pgEnum("workflow_source", WORKFLOW_SOURCES);

export const scheduleStatusEnum = pgEnum("schedule_status", SCHEDULE_STATUSES);
export const scheduleTypeEnum = pgEnum("schedule_type", SCHEDULE_TYPES);
export const scheduleOverlapPolicyEnum = pgEnum("schedule_overlap_policy", SCHEDULE_OVERLAP_POLICIES);

export const workflowRunStatusEnum = pgEnum("workflow_run_status", WORKFLOW_RUN_STATUSES);
export const terminalWorkflowRunStatusEnum = pgEnum("terminal_workflow_run_status", TERMINAL_WORKFLOW_RUN_STATUSES);

export const taskStatusEnum = pgEnum("task_status", TASK_STATUSES);

export const stateTransitionTypeEnum = pgEnum("state_transition_type", STATE_TRANSITION_TYPES);

export const sleepStatusEnum = pgEnum("sleep_status", SLEEP_STATUSES);
export const eventWaitStatusEnum = pgEnum("event_wait_status", EVENT_WAIT_STATUSES);
export const childWorkflowRunWaitStatusEnum = pgEnum(
	"child_workflow_run_wait_status",
	CHILD_WORKFLOW_RUN_WAIT_STATUSES
);

export const workflowRunOutboxStatusEnum = pgEnum("workflow_run_outbox_status", WORKFLOW_RUN_OUTBOX_STATUSES);

export const workflow = pgTable(
	"workflow",
	{
		id: text("id").primaryKey(),
		namespaceId: text("namespace_id").notNull(),
		source: workflowSourceEnum("source").notNull(),
		name: text("name").notNull(),
		versionId: text("version_id").notNull(),
		createdAt: timestampMs("created_at").notNull().default(sql`now()`),
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

export const schedule = pgTable(
	"schedule",
	{
		id: text("id").primaryKey(),
		namespaceId: text("namespace_id").notNull(),
		workflowId: text("workflow_id").notNull(),

		status: scheduleStatusEnum("status").notNull(),

		type: scheduleTypeEnum("type").notNull(),
		cronExpression: text("cron_expression"),
		cronTimezone: text("cron_timezone"),
		intervalMs: integer("interval_ms"),
		overlapPolicy: scheduleOverlapPolicyEnum("overlap_policy"),

		workflowRunInput: jsonb("workflow_run_input"),
		workflowRunInputHash: text("workflow_run_input_hash").notNull(),

		definitionHash: text("definition_hash").notNull(),

		referenceId: text("reference_id"),

		workflowRunOptions: jsonb("workflow_run_options").$type<WorkflowRunOptions>(),

		lastOccurrence: timestampMs("last_occurrence"),
		nextRunAt: timestampMs("next_run_at"),

		createdAt: timestampMs("created_at").notNull().default(sql`now()`),
		updatedAt: timestampMs("updated_at").notNull().default(sql`now()`),
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
		// TODO: how to prevent certain namespaces from starving others
		index("idx_schedule_status_next_run_at_id").on(table.status, table.nextRunAt, table.id),
		check(
			"chk_schedule_spec_matches_type",
			sql`(${table.type} = 'cron' AND ${table.cronExpression} IS NOT NULL AND ${table.intervalMs} IS NULL) OR (${table.type} = 'interval' AND ${table.intervalMs} > 0 AND ${table.cronExpression} IS NULL AND ${table.cronTimezone} IS NULL)`
		),
	]
);

export const workflowRun = pgTable(
	"workflow_run",
	{
		id: text("id").primaryKey(),
		namespaceId: text("namespace_id").notNull(),
		workflowId: text("workflow_id").notNull(),
		scheduleId: text("schedule_id"),
		parentWorkflowRunId: text("parent_workflow_run_id"),

		status: workflowRunStatusEnum("status").notNull(),
		revision: integer("revision").notNull().default(0),
		signalSequence: integer("signal_sequence").notNull().default(0),
		attempts: integer("attempts").notNull().default(1),

		input: jsonb("input"),
		inputHash: text("input_hash").notNull(),
		options: jsonb("options").$type<WorkflowRunOptions>(),

		referenceId: text("reference_id"),

		latestStateTransitionId: text("latest_state_transition_id").notNull(),
		scheduledAt: timestampMs("scheduled_at"),
		wakeupAt: timestampMs("wakeup_at"),
		timeoutAt: timestampMs("timeout_at"),
		nextAttemptAt: timestampMs("next_attempt_at"),

		createdAt: timestampMs("created_at").notNull().default(sql`now()`),
		updatedAt: timestampMs("updated_at").notNull().default(sql`now()`),
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
			name: "fk_workflow_run_parent_workflow_run",
			columns: [table.parentWorkflowRunId],
			foreignColumns: [table.id],
		}),
		uniqueIndex("uqidx_workflow_run_workflow_reference").on(table.workflowId, table.referenceId),

		index("idx_workflow_run_namespace_id").on(table.namespaceId, table.id),
		index("idx_workflow_run_namespace_status_id").on(table.namespaceId, table.status, table.id),

		index("idx_workflow_run_workflow_id").on(table.workflowId, table.id),
		index("idx_workflow_run_workflow_status_id").on(table.workflowId, table.status, table.id),

		index("idx_workflow_run_schedule_namespace").on(table.scheduleId, table.namespaceId),
		index("idx_workflow_run_parent_workflow_run_status").on(table.parentWorkflowRunId, table.status),

		// TODO: will adding an index on input hash make conflict resolution faster?

		index("idx_workflow_run_status_scheduled_at_id").on(table.status, table.scheduledAt, table.id),
		index("idx_workflow_run_status_wakeup_at_id").on(table.status, table.wakeupAt, table.id),
		index("idx_workflow_run_status_timeout_at_id").on(table.status, table.timeoutAt, table.id),
		index("idx_workflow_run_status_next_attempt_at_id").on(table.status, table.nextAttemptAt, table.id),
	]
);

export const task = pgTable(
	"task",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		workflowRunId: text("workflow_run_id").notNull(),

		status: taskStatusEnum("status").notNull(),
		attempts: integer("attempts").notNull(),

		input: jsonb("input"),
		inputHash: text("input_hash").notNull(),
		options: jsonb("options").$type<TaskStartOptions>(),

		latestStateTransitionId: text("latest_state_transition_id").notNull(),
		nextAttemptAt: timestampMs("next_attempt_at"),

		createdAt: timestampMs("created_at").notNull().default(sql`now()`),
		updatedAt: timestampMs("updated_at").notNull().default(sql`now()`),
	},
	(table) => [
		foreignKey({
			name: "fk_task_workflow_run",
			columns: [table.workflowRunId],
			foreignColumns: [workflowRun.id],
		}),
		index("idx_task_workflow_run_id").on(table.workflowRunId, table.id),
		index("idx_task_workflow_run_status").on(table.workflowRunId, table.status),
		index("idx_task_status_next_attempt_at_workflow_run").on(table.status, table.nextAttemptAt, table.workflowRunId),
	]
);

export const stateTransition = pgTable(
	"state_transition",
	{
		id: text("id").primaryKey(),
		workflowRunId: text("workflow_run_id").notNull(),
		type: stateTransitionTypeEnum("type").notNull(),
		taskId: text("task_id"),
		status: text("status").notNull(),
		attempt: integer("attempt").notNull(),
		state: jsonb("state").notNull(),
		createdAt: timestampMs("created_at").notNull().default(sql`now()`),
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
			sql`(${table.type} = 'workflow_run' AND ${table.status} = ANY(enum_range(NULL::workflow_run_status)::text[])) OR (${table.type} = 'task' AND ${table.status} = ANY(enum_range(NULL::task_status)::text[]))`
		),
	]
);

export const sleep = pgTable(
	"sleep",
	{
		id: text("id").primaryKey(),
		workflowRunId: text("workflow_run_id").notNull(),

		name: text("name").notNull(),
		status: sleepStatusEnum("status").notNull(),

		wakeupAt: timestampMs("wakeup_at").notNull(),
		completedAt: timestampMs("completed_at"),
		cancelledAt: timestampMs("cancelled_at"),

		createdAt: timestampMs("created_at").notNull().default(sql`now()`),
	},
	(table) => [
		foreignKey({
			name: "fk_sleep_workflow_run",
			columns: [table.workflowRunId],
			foreignColumns: [workflowRun.id],
		}),
		uniqueIndex("uqidx_sleep_one_active_per_run").on(table.workflowRunId).where(sql`${table.status} = 'sleeping'`),
		index("idx_sleep_workflow_run_id").on(table.workflowRunId, table.id),
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

export const eventWait = pgTable(
	"event_wait",
	{
		id: text("id").primaryKey(),
		workflowRunId: text("workflow_run_id").notNull(),

		name: text("name").notNull(),
		status: eventWaitStatusEnum("status").notNull(),
		referenceId: text("reference_id"),

		// The run's signal_sequence at the moment this row was written. Rows are handed to
		// the workflow's waits in this order: the value is assigned under the run's row
		// lock, so it is exactly the order the server accepted the sends — ids order only
		// down to the millisecond and can invert two sends that land close together on
		// different server replicas. Timeout rows sit in the same ordered queue as received
		// rows, so they carry it too. It also lets a worker fetch just the rows written
		// after the copy it loaded, the same catch-up the child wait column below serves.
		signalSequence: integer("signal_sequence").notNull(),

		data: jsonb("data"),

		timedOutAt: timestampMs("timed_out_at"),

		createdAt: timestampMs("created_at").notNull().default(sql`now()`),
	},
	(table) => [
		foreignKey({
			name: "fk_event_wait_workflow_run",
			columns: [table.workflowRunId],
			foreignColumns: [workflowRun.id],
		}),
		uniqueIndex("uqidx_event_wait_workflow_run_name_reference").on(table.workflowRunId, table.name, table.referenceId),
		index("idx_event_wait_workflow_run_signal_sequence_id").on(table.workflowRunId, table.signalSequence, table.id),
		check(
			"chk_event_wait_timeout_requires_timed_out_at",
			sql`${table.status} != 'timeout' OR ${table.timedOutAt} IS NOT NULL`
		),
	]
);

export const childWorkflowRunWait = pgTable(
	"child_workflow_run_wait",
	{
		id: text("id").primaryKey(),
		parentWorkflowRunId: text("parent_workflow_run_id").notNull(),
		childWorkflowRunId: text("child_workflow_run_id").notNull(),
		childWorkflowRunStatus: terminalWorkflowRunStatusEnum("child_workflow_run_status"),

		status: childWorkflowRunWaitStatusEnum("status").notNull(),
		completedAt: timestampMs("completed_at"),
		timedOutAt: timestampMs("timed_out_at"),

		childWorkflowRunStateTransitionId: text("child_workflow_run_state_transition_id"),

		// The parent run's signal_sequence at the moment this row was written. A child can
		// finish while its parent is executing, so a row can land that the parent's loaded
		// copy of this table lacks; the value lets the parent fetch just the rows written
		// after its copy, instead of re-reading everything. A timeout row cannot land that
		// way — it is written only while the parent is parked, and the parent re-reads
		// everything when it wakes — so there is nothing to catch up on, and it stays null.
		signalSequence: integer("signal_sequence"),

		createdAt: timestampMs("created_at").notNull().default(sql`now()`),
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

export const workflowRunOutbox = pgTable(
	"workflow_run_outbox",
	{
		id: text("id").primaryKey(),
		namespaceId: text("namespace_id").notNull(),
		workflowRunId: text("workflow_run_id").notNull(),
		workflowSource: workflowSourceEnum("workflow_source").notNull(),
		workflowName: text("workflow_name").notNull(),
		workflowVersionId: text("workflow_version_id").notNull(),
		pool: text("pool"),
		rank: doublePrecision("rank").notNull(),

		status: workflowRunOutboxStatusEnum("status").notNull(),

		claimedAt: timestampMs("claimed_at"),
		firstPublishedAt: timestampMs("first_published_at"),
		lastPublishedAt: timestampMs("last_published_at"),
		nextPublishAttemptRank: doublePrecision("next_publish_attempt_rank").notNull(),

		dispatchAttempts: integer("dispatch_attempts").notNull().default(0),

		createdAt: timestampMs("created_at").notNull().default(sql`now()`),
		updatedAt: timestampMs("updated_at").notNull().default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uqidx_workflow_run_outbox_workflow_run_id").on(table.workflowRunId),

		// Claim path: worker claims rank ordered pending rows by workflow identity and pool.
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

		// Daemon list paths: broad scans over one status to feed broker.
		index("idx_workflow_run_outbox_list_pending")
			.on(table.nextPublishAttemptRank, table.id)
			.where(sql`${table.status} = 'pending'`),
		index("idx_workflow_run_outbox_list_published")
			.on(table.nextPublishAttemptRank, table.id)
			.where(sql`${table.status} = 'published'`),
		index("idx_workflow_run_outbox_list_claimed").on(table.claimedAt, table.id).where(sql`${table.status} = 'claimed'`),

		// Stall path: id-range scan over pending and published rows to stall those past maxAgeMs.
		// claimed rows are exempt — they are executing, not waiting for delivery.
		index("idx_workflow_run_outbox_stall_undeliverable")
			.on(table.id)
			.where(sql`${table.status} IN ('pending', 'published')`),

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

// Relations for circular FK references due to TypeScript inference

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
