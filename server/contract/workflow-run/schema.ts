import type { UnionToRecord } from "@aikirun/lib/object";
import type {
	WorkflowOptions,
	WorkflowReferenceOptions,
	WorkflowRun,
	WorkflowRunState,
	WorkflowRunStateAwaitingChildWorkflow,
	WorkflowRunStateAwaitingEvent,
	WorkflowRunStateAwaitingRetry,
	WorkflowRunStateCancelled,
	WorkflowRunStateCompleted,
	WorkflowRunStateFailed,
	WorkflowRunStatePaused,
	WorkflowRunStateQueued,
	WorkflowRunStateRunning,
	WorkflowRunStateScheduled,
	WorkflowRunStateScheduledByAwake,
	WorkflowRunStateScheduledByAwakeEarly,
	WorkflowRunStateScheduledByChildWorkflow,
	WorkflowRunStateScheduledByEvent,
	WorkflowRunStateScheduledByNew,
	WorkflowRunStateScheduledByResume,
	WorkflowRunStateScheduledByRetry,
	WorkflowRunStateScheduledByTaskRetry,
	WorkflowRunStateSleeping,
	WorkflowRunStatus,
	WorkflowRunTransition,
} from "@aikirun/types/workflow-run";
import type {
	WorkflowRunSetTaskStateRequestV1,
	WorkflowRunStateAwaitingChildWorkflowRequest,
	WorkflowRunStateAwaitingEventRequest,
	WorkflowRunStateAwaitingRetryRequest,
	WorkflowRunStateScheduledRequestOptimistic,
	WorkflowRunStateScheduledRequestPessimistic,
} from "@aikirun/types/workflow-run-api";
import { z } from "zod";

import { eventsQueueSchema } from "../event/schema";
import type { Zt } from "../helpers/schema";
import { serializedErrorSchema } from "../serializable";
import { retryStrategySchema, triggerStrategySchema } from "../shared/schema";
import { sleepQueueSchema } from "../sleep/schema";
import { taskInfoSchema, taskStateSchema } from "../task/schema";

export const workflowRunStatusSchema: z.ZodEnum<UnionToRecord<WorkflowRunStatus>> = z.enum([
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

const workflowReferenceOptionsSchema: Zt<WorkflowReferenceOptions> = z.object({
	id: z.string(),
	onConflict: z.union([z.literal("error"), z.literal("return_existing")]).optional(),
});

export const workflowOptionsSchema: Zt<WorkflowOptions> = z.object({
	reference: workflowReferenceOptionsSchema.optional(),
	trigger: triggerStrategySchema.optional(),
	shard: z.string().optional(),
	retry: retryStrategySchema.optional(),
});

export const workflowRunStateScheduledByNewSchema: Zt<WorkflowRunStateScheduledByNew> = z.object({
	status: z.literal("scheduled"),
	scheduledAt: z.number(),
	reason: z.literal("new"),
});

export const workflowRunStateScheduledByRetrySchema: Zt<WorkflowRunStateScheduledByRetry> = z.object({
	status: z.literal("scheduled"),
	scheduledAt: z.number(),
	reason: z.literal("retry"),
});

export const workflowRunStateScheduledByTaskRetrySchema: Zt<WorkflowRunStateScheduledByTaskRetry> = z.object({
	status: z.literal("scheduled"),
	scheduledAt: z.number(),
	reason: z.literal("task_retry"),
});

export const workflowRunStateScheduledByAwakeSchema: Zt<WorkflowRunStateScheduledByAwake> = z.object({
	status: z.literal("scheduled"),
	scheduledAt: z.number(),
	reason: z.literal("awake"),
});

export const workflowRunStateScheduledByAwakeEarlySchema: Zt<WorkflowRunStateScheduledByAwakeEarly> = z.object({
	status: z.literal("scheduled"),
	scheduledAt: z.number(),
	reason: z.literal("awake_early"),
});

export const workflowRunStateScheduledByResumeSchema: Zt<WorkflowRunStateScheduledByResume> = z.object({
	status: z.literal("scheduled"),
	scheduledAt: z.number(),
	reason: z.literal("resume"),
});

export const workflowRunStateScheduledByEventSchema: Zt<WorkflowRunStateScheduledByEvent> = z.object({
	status: z.literal("scheduled"),
	scheduledAt: z.number(),
	reason: z.literal("event"),
});

export const workflowRunStateScheduledByChildWorkflowSchema: Zt<WorkflowRunStateScheduledByChildWorkflow> = z.object({
	status: z.literal("scheduled"),
	scheduledAt: z.number(),
	reason: z.literal("child_workflow"),
});

export const workflowRunStateScheduledSchema: Zt<WorkflowRunStateScheduled> = z.union([
	workflowRunStateScheduledByNewSchema,
	workflowRunStateScheduledByRetrySchema,
	workflowRunStateScheduledByTaskRetrySchema,
	workflowRunStateScheduledByAwakeSchema,
	workflowRunStateScheduledByAwakeEarlySchema,
	workflowRunStateScheduledByResumeSchema,
	workflowRunStateScheduledByEventSchema,
	workflowRunStateScheduledByChildWorkflowSchema,
]);

export const workflowRunStateQueuedSchema: Zt<WorkflowRunStateQueued> = z.object({
	status: z.literal("queued"),
	reason: z.union([
		z.literal("new"),
		z.literal("retry"),
		z.literal("task_retry"),
		z.literal("awake"),
		z.literal("awake_early"),
		z.literal("resume"),
		z.literal("event"),
		z.literal("child_workflow"),
	]),
});

export const workflowRunStateRunningSchema: Zt<WorkflowRunStateRunning> = z.object({
	status: z.literal("running"),
});

export const workflowRunStatePausedSchema: Zt<WorkflowRunStatePaused> = z.object({
	status: z.literal("paused"),
});

export const workflowRunStateSleepingSchema: Zt<WorkflowRunStateSleeping> = z.object({
	status: z.literal("sleeping"),
	sleepName: z.string(),
	durationMs: z.number(),
});

export const workflowRunStateAwaitingEventSchema: Zt<WorkflowRunStateAwaitingEvent> = z.object({
	status: z.literal("awaiting_event"),
	eventName: z.string(),
	timeoutAt: z.number().optional(),
});

export const workflowRunStateAwaitingRetrySchema: Zt<WorkflowRunStateAwaitingRetry> = z.union([
	z.object({
		status: z.literal("awaiting_retry"),
		cause: z.literal("task"),
		nextAttemptAt: z.number(),
		taskId: z.string().min(1),
	}),
	z.object({
		status: z.literal("awaiting_retry"),
		cause: z.literal("child_workflow"),
		nextAttemptAt: z.number(),
		childWorkflowRunId: z.string(),
	}),
	z.object({
		status: z.literal("awaiting_retry"),
		cause: z.literal("self"),
		nextAttemptAt: z.number(),
		error: serializedErrorSchema,
	}),
]);

export const workflowRunStateAwaitingChildWorkflowSchema: Zt<WorkflowRunStateAwaitingChildWorkflow> = z.object({
	status: z.literal("awaiting_child_workflow"),
	childWorkflowRunId: z.string(),
	childWorkflowRunStatus: workflowRunStatusSchema,
	timeoutAt: z.number().optional(),
});

export const workflowRunStateCancelledSchema: Zt<WorkflowRunStateCancelled> = z.object({
	status: z.literal("cancelled"),
	reason: z.string().optional(),
});

export const workflowRunStateCompletedSchema: Zt<WorkflowRunStateCompleted<unknown>> = z.object({
	status: z.literal("completed"),
	output: z.unknown(),
});

export const workflowRunStateFailedSchema: Zt<WorkflowRunStateFailed> = z.union([
	z.object({
		status: z.literal("failed"),
		cause: z.literal("task"),
		taskId: z.string(),
	}),
	z.object({
		status: z.literal("failed"),
		cause: z.literal("child_workflow"),
		childWorkflowRunId: z.string(),
	}),
	z.object({
		status: z.literal("failed"),
		cause: z.literal("self"),
		error: serializedErrorSchema,
	}),
]);

export const workflowRunStateSchema: Zt<WorkflowRunState> = z.union([
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

export const workflowRunSchema: Zt<WorkflowRun> = z.object({
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
	tasks: z.record(z.string(), taskInfoSchema),
	sleepsQueue: z.record(z.string(), sleepQueueSchema),
	eventsQueue: z.record(z.string(), eventsQueueSchema),
	childWorkflowRuns: z.record(
		z.string(),
		z.object({
			id: z.string(),
			inputHash: z.string(),
			statusWaitResults: z.array(
				z.union([
					z.object({
						status: z.literal("completed"),
						completedAt: z.number(),
						childWorkflowRunState: workflowRunStateSchema,
					}),
					z.object({
						status: z.literal("timeout"),
						timedOutAt: z.number(),
					}),
				])
			),
		})
	),
	parentWorkflowRunId: z.string().optional(),
});

export const workflowRunTransitionSchema: Zt<WorkflowRunTransition> = z.discriminatedUnion("type", [
	z.object({
		id: z.string(),
		type: z.literal("state"),
		createdAt: z.number(),
		state: workflowRunStateSchema,
	}),
	z.object({
		id: z.string(),
		type: z.literal("task_state"),
		createdAt: z.number(),
		taskId: z.string(),
		taskState: taskStateSchema,
	}),
]);

export const workflowRunStateScheduledRequestOptimisticSchema: Zt<WorkflowRunStateScheduledRequestOptimistic> = z.union(
	[
		z.object({
			status: z.literal("scheduled"),
			reason: z.literal("retry"),
			scheduledInMs: z.number(),
		}),
		z.object({
			status: z.literal("scheduled"),
			reason: z.literal("task_retry"),
			scheduledInMs: z.number(),
		}),
		z.object({
			status: z.literal("scheduled"),
			reason: z.literal("event"),
			scheduledInMs: z.number(),
		}),
		z.object({
			status: z.literal("scheduled"),
			reason: z.literal("child_workflow"),
			scheduledInMs: z.number(),
		}),
	]
);

export const workflowRunStateScheduledRequestPessimisticSchema: Zt<WorkflowRunStateScheduledRequestPessimistic> =
	z.union([
		z.object({
			status: z.literal("scheduled"),
			reason: z.enum(["new"]),
			scheduledInMs: z.number(),
		}),
		z.object({
			status: z.literal("scheduled"),
			reason: z.enum(["resume"]),
			scheduledInMs: z.number(),
		}),
		z.object({
			status: z.literal("scheduled"),
			reason: z.enum(["awake_early"]),
			scheduledInMs: z.number(),
		}),
	]);

export const workflowRunStateAwaitingEventRequestSchema: Zt<WorkflowRunStateAwaitingEventRequest> = z.object({
	status: z.literal("awaiting_event"),
	eventName: z.string(),
	timeoutInMs: z.number().optional(),
});

export const workflowRunStateAwaitingRetryRequestSchema: Zt<WorkflowRunStateAwaitingRetryRequest> = z.union([
	z.object({
		status: z.literal("awaiting_retry"),
		cause: z.literal("task"),
		taskId: z.string().min(1),
		nextAttemptInMs: z.number(),
	}),
	z.object({
		status: z.literal("awaiting_retry"),
		cause: z.literal("child_workflow"),
		childWorkflowRunId: z.string(),
		nextAttemptInMs: z.number(),
	}),
	z.object({
		status: z.literal("awaiting_retry"),
		cause: z.literal("self"),
		error: serializedErrorSchema,
		nextAttemptInMs: z.number(),
	}),
]);

export const workflowRunStateAwaitingChildWorkflowRequestSchema: Zt<WorkflowRunStateAwaitingChildWorkflowRequest> =
	z.object({
		status: z.literal("awaiting_child_workflow"),
		childWorkflowRunId: z.string(),
		childWorkflowRunStatus: workflowRunStatusSchema,
		timeoutInMs: z.number().optional(),
	});

const taskStateOutputSchema: Zt<WorkflowRunSetTaskStateRequestV1["state"]> = z.discriminatedUnion("status", [
	z.object({ status: z.literal("completed"), output: z.unknown() }),
	z.object({ status: z.literal("failed"), error: serializedErrorSchema }),
]);

export const workflowRunSetTaskStateRequestSchema: Zt<WorkflowRunSetTaskStateRequestV1> = z.discriminatedUnion("type", [
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
