import { z } from "zod";
import { WORKFLOW_RUN_STATES, type WorkflowRunId, type WorkflowRunParams } from "@aiki/types/workflow";
import type { TaskRunResult } from "@aiki/types/task";
import { initWorkflowRunRepository } from "../repository/workflow-run.ts";
import { trpcProceduce, trpcRouter } from "../context.ts";

const workflowRunRepository = await initWorkflowRunRepository();

export const workflowRunRouter = trpcRouter({
	getReadyIdsV1: trpcProceduce
		.input(z.object({ size: z.number().int().positive() }))
		.query(async ({ input }) => {
			const ids = await workflowRunRepository.getReadyIds(input.size);
			return ids;
		}),

	getByIdV1: trpcProceduce
		.input(z.object({ id: z.string() }))
		.query(async ({ input }) => {
			const row = await workflowRunRepository.getById(input.id as WorkflowRunId);
			return row;
		}),

	getResultV1: trpcProceduce
		.input(z.object({ id: z.string() }))
		.query(async ({ input }) => {
			const result = await workflowRunRepository.getResult(input.id);
			return result;
		}),

	createV1: trpcProceduce
		.input(
			z.object({
				name: z.string(),
				versionId: z.string(),
				params: z.object({
					payload: z.unknown().optional(),
					idempotencyKey: z.string().optional(),
					trigger: z.unknown().optional(),
					shard: z.string().optional(),
				}),
			}),
		)
		.mutation(async ({ input }) => {
			const row = await workflowRunRepository.create(
				input.name,
				input.versionId,
				input.params as WorkflowRunParams<unknown>,
			);
			return row;
		}),

	addSubTaskRunResultV1: trpcProceduce
		.input(
			z.object({
				workflowRunId: z.string(),
				taskPath: z.string(),
				taskResult: z.unknown(),
			}),
		)
		.mutation(async ({ input }) => {
			await workflowRunRepository.addSubTaskRunResult(
				input.workflowRunId,
				input.taskPath,
				input.taskResult as TaskRunResult<unknown>,
			);
		}),

	updateStateV1: trpcProceduce
		.input(
			z.object({
				id: z.string(),
				state: z.enum(WORKFLOW_RUN_STATES),
			}),
		)
		.mutation(async ({ input }) => {
			await workflowRunRepository.updateState(input.id, input.state);
		}),
});
