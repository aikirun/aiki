import { z } from "zod";

import { eventsQueueSchema } from "../event/schema";
import { serializedErrorSchema } from "../serializable";
import { retryStrategySchema, triggerStrategySchema } from "../shared/schema";
import { sleepQueueSchema } from "../sleep/schema";
import { taskInfoSchema, taskStateSchema } from "../task/schema";

export const workflowRunStatusSchema = z.enum([
	"scheduled",
	"queued",
	"running",
	"paused",
	"sleeping",
	"awaiting_event",
	"awaiting_retry",
	"awaiting_child_workflow",
	"cancelled",
	"failed",
	"completed",
]);

const workflowReferenceOptionsSchema = z.object({
	id: z.string(),
	onConflict: z.enum(["error", "return_existing"]).optional(),
});

export const workflowOptionsSchema = z.object({
	reference: workflowReferenceOptionsSchema.optional(),
	trigger: triggerStrategySchema.optional(),
	shard: z.string().optional(),
	retry: retryStrategySchema.optional(),
});

const workflowRunScheduledReasonSchema = z.enum([
	"new",
	"retry",
	"task_retry",
	"awake",
	"awake_early",
	"resume",
	"event",
	"child_workflow",
]);

const workflowRunStateScheduledBaseSchema = z.object({
	status: z.literal("scheduled"),
	scheduledAt: z.number(),
	reason: workflowRunScheduledReasonSchema,
});

export const workflowRunStateScheduledSchema = z.discriminatedUnion("status", [
	workflowRunStateScheduledBaseSchema.extend({ reason: z.literal("new") }),
	workflowRunStateScheduledBaseSchema.extend({ reason: z.literal("retry") }),
	workflowRunStateScheduledBaseSchema.extend({ reason: z.literal("task_retry") }),
	workflowRunStateScheduledBaseSchema.extend({ reason: z.literal("awake") }),
	workflowRunStateScheduledBaseSchema.extend({ reason: z.literal("awake_early") }),
	workflowRunStateScheduledBaseSchema.extend({ reason: z.literal("resume") }),
	workflowRunStateScheduledBaseSchema.extend({ reason: z.literal("event") }),
	workflowRunStateScheduledBaseSchema.extend({ reason: z.literal("child_workflow") }),
]);

export const workflowRunStateQueuedSchema = z.object({
	status: z.literal("queued"),
	reason: workflowRunScheduledReasonSchema,
});

export const workflowRunStateRunningSchema = z.object({
	status: z.literal("running"),
});

export const workflowRunStatePausedSchema = z.object({
	status: z.literal("paused"),
});

export const workflowRunStateSleepingSchema = z.object({
	status: z.literal("sleeping"),
	sleepName: z.string().min(1),
	durationMs: z.number().positive(),
});

export const workflowRunStateAwaitingEventSchema = z.object({
	status: z.literal("awaiting_event"),
	eventName: z.string().min(1),
	timeoutAt: z.number().positive().optional(),
});

const workflowFailureCauseSchema = z.enum(["task", "child_workflow", "self"]);

const workflowRunStateAwaitingRetryBaseSchema = z.object({
	status: z.literal("awaiting_retry"),
	cause: workflowFailureCauseSchema,
	nextAttemptAt: z.number().positive(),
});

export const workflowRunStateAwaitingRetrySchema = z.discriminatedUnion("cause", [
	workflowRunStateAwaitingRetryBaseSchema.extend({
		cause: z.literal("task"),
		taskId: z.string().min(1),
	}),
	workflowRunStateAwaitingRetryBaseSchema.extend({
		cause: z.literal("child_workflow"),
		childWorkflowRunId: z.string().min(1),
	}),
	workflowRunStateAwaitingRetryBaseSchema.extend({
		cause: z.literal("self"),
		error: serializedErrorSchema,
	}),
]);

export const workflowRunStateAwaitingChildWorkflowSchema = z.object({
	status: z.literal("awaiting_child_workflow"),
	childWorkflowRunId: z.string().min(1),
	childWorkflowRunStatus: workflowRunStatusSchema,
	timeoutAt: z.number().positive().optional(),
});

export const workflowRunStateCancelledSchema = z.object({
	status: z.literal("cancelled"),
	reason: z.string().min(1).optional(),
});

export const workflowRunStateCompletedSchema = z.object({
	status: z.literal("completed"),
	output: z.unknown(),
});

const workflowRunStateFailedBaseSchema = z.object({
	status: z.literal("failed"),
	cause: workflowFailureCauseSchema,
});

export const workflowRunStateFailedSchema = z.discriminatedUnion("cause", [
	workflowRunStateFailedBaseSchema.extend({
		cause: z.literal("task"),
		taskId: z.string().min(1),
	}),
	workflowRunStateFailedBaseSchema.extend({
		cause: z.literal("child_workflow"),
		childWorkflowRunId: z.string().min(1),
	}),
	workflowRunStateFailedBaseSchema.extend({
		cause: z.literal("self"),
		error: serializedErrorSchema,
	}),
]);

export const workflowRunStateSchema = z.discriminatedUnion("status", [
	workflowRunStateScheduledSchema,
	workflowRunStateQueuedSchema,
	workflowRunStateRunningSchema,
	workflowRunStatePausedSchema,
	workflowRunStateSleepingSchema,
	workflowRunStateAwaitingEventSchema,
	workflowRunStateAwaitingRetrySchema,
	workflowRunStateAwaitingChildWorkflowSchema,
	workflowRunStateCancelledSchema,
	workflowRunStateCompletedSchema,
	workflowRunStateFailedSchema,
]);

const childWorkflowRunInfoSchema = z.object({
	id: z.string().min(1),
	inputHash: z.string().min(1),
	statusWaitResults: z.array(
		z.discriminatedUnion("status", [
			z.object({
				status: z.literal("completed"),
				completedAt: z.number().positive(),
				childWorkflowRunState: workflowRunStateSchema,
			}),
			z.object({
				status: z.literal("timeout"),
				timedOutAt: z.number().positive(),
			}),
		])
	),
});

export const workflowRunSchema = z.object({
	id: z.string(),
	name: z.string(),
	versionId: z.string(),
	createdAt: z.number(),
	revision: z.number(),
	input: z.unknown(),
	path: z.string(),
	options: workflowOptionsSchema,
	attempts: z.number(),
	state: workflowRunStateSchema,
	tasks: z.record(z.string().min(1), taskInfoSchema),
	sleepsQueue: z.record(z.string().min(1), sleepQueueSchema),
	eventsQueue: z.record(z.string().min(1), eventsQueueSchema),
	childWorkflowRuns: z.record(z.string().min(1), childWorkflowRunInfoSchema),
	parentWorkflowRunId: z.string().min(1).optional(),
});

const workflowRunTransitionBaseSchema = z.object({
	id: z.string(),
	createdAt: z.number(),
	type: z.enum(["state", "task_state"]),
});

export const workflowRunTransitionSchema = z.discriminatedUnion("type", [
	workflowRunTransitionBaseSchema.extend({
		type: z.literal("state"),
		state: workflowRunStateSchema,
	}),
	workflowRunTransitionBaseSchema.extend({
		type: z.literal("task_state"),
		taskId: z.string(),
		taskState: taskStateSchema,
	}),
]);

const workflowRunStateScheduledRequestBaseSchema = z.object({
	status: z.literal("scheduled"),
	reason: workflowRunScheduledReasonSchema,
	scheduledInMs: z.number().positive(),
});

export const workflowRunStateScheduledRequestOptimisticSchema = z.discriminatedUnion("reason", [
	workflowRunStateScheduledRequestBaseSchema.extend({ reason: z.literal("retry") }),
	workflowRunStateScheduledRequestBaseSchema.extend({ reason: z.literal("task_retry") }),
	workflowRunStateScheduledRequestBaseSchema.extend({ reason: z.literal("awake") }),
	workflowRunStateScheduledRequestBaseSchema.extend({ reason: z.literal("event") }),
	workflowRunStateScheduledRequestBaseSchema.extend({ reason: z.literal("child_workflow") }),
]);

export const workflowRunStateScheduledRequestPessimisticSchema = z.discriminatedUnion("reason", [
	workflowRunStateScheduledRequestBaseSchema.extend({ reason: z.enum(["new"]) }),
	workflowRunStateScheduledRequestBaseSchema.extend({ reason: z.enum(["awake_early"]) }),
	workflowRunStateScheduledRequestBaseSchema.extend({ reason: z.enum(["resume"]) }),
]);

export const workflowRunStateAwaitingEventRequestSchema = z.object({
	status: z.literal("awaiting_event"),
	eventName: z.string().min(1),
	timeoutInMs: z.number().positive().optional(),
});

export const workflowRunStateAwaitingRetryRequestSchema = z.discriminatedUnion("cause", [
	z.object({
		status: z.literal("awaiting_retry"),
		cause: z.literal("task"),
		taskId: z.string().min(1),
		nextAttemptInMs: z.number().positive(),
	}),
	z.object({
		status: z.literal("awaiting_retry"),
		cause: z.literal("child_workflow"),
		childWorkflowRunId: z.string().min(1),
		nextAttemptInMs: z.number().positive(),
	}),
	z.object({
		status: z.literal("awaiting_retry"),
		cause: z.literal("self"),
		error: serializedErrorSchema,
		nextAttemptInMs: z.number().positive(),
	}),
]);

export const workflowRunStateAwaitingChildWorkflowRequestSchema = z.object({
	status: z.literal("awaiting_child_workflow"),
	childWorkflowRunId: z.string().min(1),
	childWorkflowRunStatus: workflowRunStatusSchema,
	timeoutInMs: z.number().positive().optional(),
});

const taskStateOutputSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("completed"), output: z.unknown() }),
	z.object({ status: z.literal("failed"), error: serializedErrorSchema }),
]);

export const workflowRunSetTaskStateRequestSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("new"),
		id: z.string().min(1),
		taskName: z.string().min(1),
		input: z.unknown(),
		reference: z.object({ id: z.string().min(1) }).optional(),
		state: taskStateOutputSchema,
	}),
	z.object({
		type: z.literal("existing"),
		id: z.string().min(1),
		taskId: z.string().min(1),
		state: taskStateOutputSchema,
	}),
]);
