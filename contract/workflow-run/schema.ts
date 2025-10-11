import { z } from "zod";
import type { WorkflowOptions, WorkflowRun, WorkflowRunResult, WorkflowRunState } from "./types.ts";
import type { UnionToRecord } from "@aiki/lib/object";
import { taskRunResultSchema } from "../task-run/schema.ts";
import type { zT } from "../common/schema.ts";
import type { TriggerStrategy } from "@aiki/lib/trigger";

export const workflowRunStateSchema: z.ZodEnum<UnionToRecord<WorkflowRunState>> = z.enum([
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

export const workflowRunResultSchema: zT<WorkflowRunResult<unknown>> = z
	.discriminatedUnion("state", [
		z.object({
			state: workflowRunStateSchema.exclude(["completed"]),
		}),
		z.object({
			state: z.literal("completed"),
			output: z.unknown(),
		}),
	]);

export const workflowRunSchema: zT<WorkflowRun<unknown, unknown>> = z
	.object({
		id: z.string(),
		name: z.string(),
		versionId: z.string(),
		input: z.unknown(),
		options: workflowOptionsSchema,
		result: workflowRunResultSchema,
		subTasksRunResult: z.record(z.string(), taskRunResultSchema),
		subWorkflowsRunResult: z.record(z.string(), workflowRunResultSchema),
	});
