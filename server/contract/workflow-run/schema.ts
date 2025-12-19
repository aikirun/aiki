import { z } from "zod";
import type {
	WorkflowOptions,
	WorkflowRun,
	WorkflowRunState,
	WorkflowRunStatus,
	WorkflowRunTransition,
} from "@aikirun/types/workflow-run";
import type { TriggerStrategy } from "@aikirun/types/trigger";
import type { RetryStrategy } from "@aikirun/lib/retry";
import type { DurationObject } from "@aikirun/lib/duration";
import type { UnionToRecord } from "@aikirun/lib/object";
import { sleepStateSchema } from "../sleep/schema";
import { taskStateSchema } from "../task/schema";
import type { Zt } from "../helpers/schema";
import { serializedErrorSchema } from "../serializable";

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

export const workflowRunStateSchema: Zt<WorkflowRunState<unknown>> = z.union([
	z.object({
		status: workflowRunStatusSchema.exclude([
			"scheduled",
			"queued",
			"paused",
			"sleeping",
			"awaiting_retry",
			"cancelled",
			"completed",
			"failed",
		]),
	}),
	z.object({
		status: z.literal("scheduled"),
		scheduledAt: z.number(),
		reason: z.union([
			z.literal("new"),
			z.literal("retry"),
			z.literal("awake"),
			z.literal("resume"),
			z.literal("event"),
		]),
	}),
	z.object({
		status: z.literal("queued"),
	}),
	z.object({
		status: z.literal("sleeping"),
		sleepPath: z.string(),
		durationMs: z.number(),
	}),
	z.object({
		status: z.literal("paused"),
		pausedAt: z.number(),
	}),
	z.object({
		status: z.literal("awaiting_retry"),
		cause: z.literal("task"),
		reason: z.string(),
		nextAttemptAt: z.number(),
		taskPath: z.string(),
	}),
	z.object({
		status: z.literal("awaiting_retry"),
		cause: z.literal("child_workflow"),
		reason: z.string(),
		nextAttemptAt: z.number(),
		childWorkflowRunId: z.string(),
	}),
	z.object({
		status: z.literal("awaiting_retry"),
		cause: z.literal("self"),
		reason: z.string(),
		nextAttemptAt: z.number(),
		error: serializedErrorSchema,
	}),
	z.object({
		status: z.literal("cancelled"),
		reason: z.string().optional(),
	}),
	z.object({
		status: z.literal("completed"),
		output: z.unknown(),
	}),
	z.object({
		status: z.literal("failed"),
		cause: z.literal("task"),
		reason: z.string(),
		taskPath: z.string(),
	}),
	z.object({
		status: z.literal("failed"),
		cause: z.literal("child_workflow"),
		reason: z.string(),
		childWorkflowRunId: z.string(),
	}),
	z.object({
		status: z.literal("failed"),
		cause: z.literal("self"),
		reason: z.string(),
		error: serializedErrorSchema,
	}),
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
