import type { DurationObject } from "@aikirun/lib/duration";
import type { UnionToRecord } from "@aikirun/lib/object";
import type { RetryStrategy } from "@aikirun/lib/retry";
import type { TriggerStrategy } from "@aikirun/types/trigger";
import type {
	WorkflowOptions,
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
	WorkflowRunStateAwaitingRetryRequest,
	WorkflowRunStateScheduledRequestOptimistic,
} from "@aikirun/types/workflow-run-api";
import { z } from "zod";

import type { Zt } from "../helpers/schema";
import { serializedErrorSchema } from "../serializable";
import { sleepStateSchema } from "../sleep/schema";
import { taskStateSchema } from "../task/schema";

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

export const durationObjectSchema: Zt<DurationObject> = z.union([
	z.object({
		days: z.number(),
		hours: z.number().optional(),
		minutes: z.number().optional(),
		seconds: z.number().optional(),
		milliseconds: z.number().optional(),
	}),
	z.object({
		days: z.number().optional(),
		hours: z.number(),
		minutes: z.number().optional(),
		seconds: z.number().optional(),
		milliseconds: z.number().optional(),
	}),
	z.object({
		days: z.number().optional(),
		hours: z.number().optional(),
		minutes: z.number(),
		seconds: z.number().optional(),
		milliseconds: z.number().optional(),
	}),
	z.object({
		days: z.number().optional(),
		hours: z.number().optional(),
		minutes: z.number().optional(),
		seconds: z.number(),
		milliseconds: z.number().optional(),
	}),
	z.object({
		days: z.number().optional(),
		hours: z.number().optional(),
		minutes: z.number().optional(),
		seconds: z.number().optional(),
		milliseconds: z.number(),
	}),
]);

export const triggerStrategySchema: Zt<TriggerStrategy> = z.union([
	z.object({ type: z.literal("immediate") }),
	z.object({ type: z.literal("delayed"), delayMs: z.number() }),
	z.object({ type: z.literal("delayed"), delay: durationObjectSchema }),
	z.object({ type: z.literal("startAt"), startAt: z.number() }),
]);

export const retryStrategySchema: Zt<RetryStrategy> = z.discriminatedUnion("type", [
	z.object({ type: z.literal("never") }),
	z.object({ type: z.literal("fixed"), maxAttempts: z.number(), delayMs: z.number() }),
	z.object({
		type: z.literal("exponential"),
		maxAttempts: z.number(),
		baseDelayMs: z.number(),
		maxDelayMs: z.number(),
	}),
	z.object({ type: z.literal("jittered"), maxAttempts: z.number(), baseDelayMs: z.number(), maxDelayMs: z.number() }),
]);

export const workflowOptionsSchema: Zt<WorkflowOptions> = z.object({
	idempotencyKey: z.string().optional(),
	trigger: triggerStrategySchema.optional(),
	shardKey: z.string().optional(),
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

export const workflowRunStateScheduledSchema: Zt<WorkflowRunStateScheduled> = z.union([
	workflowRunStateScheduledByNewSchema,
	workflowRunStateScheduledByRetrySchema,
	workflowRunStateScheduledByTaskRetrySchema,
	workflowRunStateScheduledByAwakeSchema,
	workflowRunStateScheduledByResumeSchema,
	workflowRunStateScheduledByEventSchema,
]);

export const workflowRunStateQueuedSchema: Zt<WorkflowRunStateQueued> = z.object({
	status: z.literal("queued"),
	reason: z.union([
		z.literal("new"),
		z.literal("retry"),
		z.literal("task_retry"),
		z.literal("awake"),
		z.literal("resume"),
		z.literal("event"),
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
	sleepPath: z.string(),
	durationMs: z.number(),
});

export const workflowRunStateAwaitingEventSchema: Zt<WorkflowRunStateAwaitingEvent> = z.object({
	status: z.literal("awaiting_event"),
});

export const workflowRunStateAwaitingRetrySchema: Zt<WorkflowRunStateAwaitingRetry> = z.union([
	z.object({
		status: z.literal("awaiting_retry"),
		cause: z.literal("task"),
		nextAttemptAt: z.number(),
		taskPath: z.string(),
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
		taskPath: z.string(),
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
	workflowId: z.string(),
	workflowVersionId: z.string(),
	createdAt: z.number(),
	revision: z.number(),
	input: z.unknown(),
	options: workflowOptionsSchema,
	attempts: z.number(),
	state: workflowRunStateSchema,
	tasksState: z.record(z.string(), taskStateSchema),
	sleepsState: z.record(z.string(), sleepStateSchema),
	childWorkflowsRunState: z.record(z.string(), workflowRunStateSchema),
});

export const workflowRunTransitionSchema: Zt<WorkflowRunTransition> = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("state"),
		createdAt: z.number(),
		state: workflowRunStateSchema,
	}),
	z.object({
		type: z.literal("task_state"),
		createdAt: z.number(),
		taskPath: z.string(),
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
			reason: z.literal("awake"),
			scheduledInMs: z.number(),
		}),
		z.object({
			status: z.literal("scheduled"),
			reason: z.literal("event"),
			scheduledInMs: z.number(),
		}),
	]
);

export const workflowRunStateScheduledRequestPessimisticSchema = z.union([
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
]);

export const workflowRunStateAwaitingRetryRequestSchema: Zt<WorkflowRunStateAwaitingRetryRequest> = z.union([
	z.object({
		status: z.literal("awaiting_retry"),
		cause: z.literal("task"),
		taskPath: z.string(),
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
