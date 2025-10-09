import { z } from "zod";
import type { WorkflowOptions, WorkflowRunId, WorkflowRunResult, WorkflowRunRow, WorkflowRunState } from "./types.ts";
import { triggerStrategySchema } from "@aiki/lib/trigger";
import type { UnionToRecord } from "@aiki/lib/object";
import { taskRunResultSchema } from "../task-run/schemas.ts";
import type { WorkflowName, WorkflowVersionId } from "../workflow/types.ts";

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

export const workflowOptionsSchema: z.ZodType<WorkflowOptions, WorkflowOptions> = z.object({
	idempotencyKey: z.string().optional(),
	trigger: triggerStrategySchema.optional(),
	shardKey: z.string().optional(),
});

export const workflowRunResultSchema: z.ZodType<WorkflowRunResult<unknown>> = z.discriminatedUnion("state", [
	z.object({
		state: workflowRunStateSchema.exclude(["completed"]),
	}),
	z.object({
		state: z.literal("completed"),
		result: z.unknown(),
	}),
]);

export const workflowRunRowSchema: z.ZodType<WorkflowRunRow<unknown, unknown>> = z.object({
	id: z.string().transform((val) => val as WorkflowRunId),
	name: z.string().transform((val) => val as WorkflowName),
	versionId: z.string().transform((val) => val as WorkflowVersionId),
	payload: z.unknown(),
	options: workflowOptionsSchema,
	result: workflowRunResultSchema,
	subTasksRunResult: z.record(z.string(), taskRunResultSchema),
	subWorkflowsRunResult: z.record(z.string(), workflowRunResultSchema),
});
