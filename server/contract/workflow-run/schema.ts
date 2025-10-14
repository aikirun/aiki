import { z } from "zod";
import type { WorkflowOptions, WorkflowRun, WorkflowRunState, WorkflowRunStatus } from "@aiki/types/workflow-run";
import type { TriggerStrategy } from "@aiki/types/trigger";
import type { UnionToRecord } from "@aiki/lib/object";
import { taskStateSchema } from "../task/schema.ts";
import type { zT } from "../helpers/schema.ts";
import { serializedErrorSchema } from "../serializable.ts";

export const workflowRunStatusSchema: z.ZodEnum<UnionToRecord<WorkflowRunStatus>> = z.enum([
	"scheduled",
	"queued",
	"starting",
	"running",
	"paused",
	"sleeping",
	"awaiting_event",
	"awaiting_retry",
	"awaiting_sub_workflow",
	"cancelled",
	"failed",
	"completed",
]);

export const triggerStrategySchema: zT<TriggerStrategy> = z.discriminatedUnion("type", [
	z.object({ type: z.literal("immediate") }),
	z.object({ type: z.literal("delayed"), delayMs: z.number() }),
	z.object({ type: z.literal("startAt"), startAt: z.number() }),
]);

export const workflowOptionsSchema: zT<WorkflowOptions> = z.object({
	idempotencyKey: z.string().optional(),
	trigger: triggerStrategySchema.optional(),
	shardKey: z.string().optional(),
});

export const workflowRunStateSchema: zT<WorkflowRunState<unknown>> = z
	.discriminatedUnion("status", [
		z.object({
			status: workflowRunStatusSchema.exclude(["completed", "failed"]),
		}),
		z.object({
			status: z.literal("completed"),
			output: z.unknown(),
		}),
		z.object({
			status: z.literal("failed"),
			cause: z.literal("task"),
			taskName: z.string(),
			reason: z.string(),
		}),
		z.object({
			status: z.literal("failed"),
			cause: z.literal("sub_workflow"),
			subWorkflowName: z.string(),
			reason: z.string(),
		}),
		z.object({
			status: z.literal("failed"),
			cause: z.literal("self"),
			reason: z.string(),
			error: serializedErrorSchema,
		}),
	]);

export const workflowRunSchema: zT<WorkflowRun<unknown, unknown>> = z
	.object({
		id: z.string(),
		name: z.string(),
		versionId: z.string(),
		revision: z.number(),
		input: z.unknown(),
		options: workflowOptionsSchema,
		state: workflowRunStateSchema,
		tasksState: z.record(z.string(), taskStateSchema),
		subWorkflowsRunState: z.record(z.string(), workflowRunStateSchema),
	});
