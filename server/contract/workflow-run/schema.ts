import { z } from "zod";
import type { WorkflowOptions, WorkflowRun, WorkflowRunState, WorkflowRunStatus } from "@aiki/types/workflow-run";
import type { TriggerStrategy } from "@aiki/types/trigger";
import type { RetryStrategy } from "@aiki/lib/retry";
import type { UnionToRecord } from "@aiki/lib/object";
import { taskStateSchema } from "../task/schema.ts";
import type { zT } from "../helpers/schema.ts";
import { serializedErrorSchema } from "../serializable.ts";

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

export const triggerStrategySchema: zT<TriggerStrategy> = z.discriminatedUnion("type", [
	z.object({ type: z.literal("immediate") }),
	z.object({ type: z.literal("delayed"), delayMs: z.number() }),
	z.object({ type: z.literal("startAt"), startAt: z.number() }),
]);

export const retryStrategySchema: zT<RetryStrategy> = z.discriminatedUnion("type", [
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

export const workflowOptionsSchema: zT<WorkflowOptions> = z.object({
	idempotencyKey: z.string().optional(),
	trigger: triggerStrategySchema.optional(),
	shardKey: z.string().optional(),
	retry: retryStrategySchema.optional(),
});

export const workflowRunStateSchema: zT<WorkflowRunState<unknown>> = z
	.discriminatedUnion("status", [
		z.object({
			status: workflowRunStatusSchema.exclude([
				"scheduled",
				"queued",
				"sleeping",
				"awaiting_retry",
				"completed",
				"failed",
			]),
		}),
		z.object({
			status: z.literal("scheduled"),
			scheduledAt: z.number(),
		}),
		z.object({
			status: z.literal("queued"),
			reason: z.union([
				z.literal("new"),
				z.literal("event"),
				z.literal("retry"),
				z.literal("awake"),
			]),
		}),
		z.object({
			status: z.literal("sleeping"),
			awakeAt: z.number(),
		}),
		z.object({
			status: z.literal("awaiting_retry"),
			cause: z.literal("task"),
			reason: z.string(),
			nextAttemptAt: z.number(),
			taskName: z.string(),
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
			status: z.literal("completed"),
			output: z.unknown(),
		}),
		z.object({
			status: z.literal("failed"),
			cause: z.literal("task"),
			reason: z.string(),
			taskName: z.string(),
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

export const workflowRunSchema: zT<WorkflowRun> = z
	.object({
		id: z.string(),
		name: z.string(),
		versionId: z.string(),
		revision: z.number(),
		attempts: z.number(),
		input: z.unknown(),
		options: workflowOptionsSchema,
		state: workflowRunStateSchema,
		tasksState: z.record(z.string(), taskStateSchema),
		childWorkflowsRunState: z.record(z.string(), workflowRunStateSchema),
	});
