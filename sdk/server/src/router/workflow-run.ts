import type { WorkflowRunId } from "@aikirun/types/workflow/run";

import { namespaceAuthedImplementer } from "./implementer";
import { runConcurrently } from "../lib/concurrency";
import type { TaskStateMachineService } from "../service/task-state-machine";
import type { WorkflowRunService } from "../service/workflow-run";
import type { WorkflowRunOutboxService } from "../service/workflow-run-outbox";
import type { WorkflowRunStateMachineService } from "../service/workflow-run-state-machine";

export interface WorkflowRunRouterDeps {
	workflowRunService: WorkflowRunService;
	workflowRunStateMachineService: WorkflowRunStateMachineService;
	taskStateMachineService: TaskStateMachineService;
	workflowRunOutboxService: WorkflowRunOutboxService;
}

export function createWorkflowRunRouter(deps: WorkflowRunRouterDeps) {
	const os = namespaceAuthedImplementer.workflowRun;
	const { workflowRunService, workflowRunStateMachineService, taskStateMachineService, workflowRunOutboxService } =
		deps;

	return os.router({
		listV1: os.listV1.handler(async ({ input: request, context }) => {
			return workflowRunService.listWorkflowRuns(context, request);
		}),

		getByIdV1: os.getByIdV1.handler(async ({ input: request, context }) => {
			return {
				run: await workflowRunService.getWorkflowRunById(context, request.id),
			};
		}),

		getByReferenceIdV1: os.getByReferenceIdV1.handler(async ({ input: request, context }) => {
			return {
				run: await workflowRunService.getWorkflowRunByReferenceId(context, request),
			};
		}),

		getStateV1: os.getStateV1.handler(async ({ input: request, context }) => {
			return {
				state: await workflowRunService.getWorkflowRunState(context, request.id),
			};
		}),

		createV1: os.createV1.handler(async ({ input: request, context }) => {
			return {
				id: await workflowRunService.createWorkflowRun(context, request),
			};
		}),

		transitionStateV1: os.transitionStateV1.handler(async ({ input: request, context }) => {
			return workflowRunStateMachineService.transitionState(context, request);
		}),

		transitionTaskStateV1: os.transitionTaskStateV1.handler(async ({ input: request, context }) => {
			const taskInfo = await taskStateMachineService.transitionState(context, request);
			return { taskInfo };
		}),

		setTaskStateV1: os.setTaskStateV1.handler(async ({ input: request, context }) => {
			await workflowRunService.setTaskState(context, request);
		}),

		listTransitionsV1: os.listTransitionsV1.handler(async ({ input: request, context }) => {
			return workflowRunService.listWorkflowRunTransitions(context, request);
		}),

		sendEventV1: os.sendEventV1.handler(async ({ input: request, context }) => {
			const runId = request.id as WorkflowRunId;
			await workflowRunService.sendEventToWorkflowRun(
				context,
				runId,
				request.eventName,
				request.data,
				request.options?.reference
			);
		}),

		multicastEventV1: os.multicastEventV1.handler(async ({ input: request, context }) => {
			const runIds = request.ids as WorkflowRunId[];
			const { eventName, data, options } = request;

			await runConcurrently(context, runIds, async (runId, spanCtx) => {
				await workflowRunService.sendEventToWorkflowRun(spanCtx, runId, eventName, data, options?.reference);
			});
		}),

		multicastEventByReferenceV1: os.multicastEventByReferenceV1.handler(async ({ input: request, context }) => {
			const runIds = await workflowRunService.resolveRunIdsByReferences(context, request.references);
			const { eventName, data, options } = request;

			await runConcurrently(context, runIds, async (runId, spanCtx) => {
				await workflowRunService.sendEventToWorkflowRun(spanCtx, runId, eventName, data, options?.reference);
			});
		}),

		listChildRunsV1: os.listChildRunsV1.handler(async ({ input: request, context }) => {
			return workflowRunService.listChildRuns(context, request);
		}),

		cancelByIdsV1: os.cancelByIdsV1.handler(async ({ input: request, context }) => {
			return workflowRunService.cancelByIds(context, request);
		}),

		claimReadyV1: os.claimReadyV1.handler(async ({ input: request, context }) => {
			return { runs: await workflowRunOutboxService.claimReady(context, request) };
		}),

		claimRefreshV1: os.claimRefreshV1.handler(async ({ input: request, context }) => {
			await workflowRunOutboxService.reclaim(context, request.id as WorkflowRunId);
		}),

		hasTerminatedV1: os.hasTerminatedV1.handler(async ({ input: request, context }) => {
			return workflowRunService.hasTerminated(context, request.id, request.afterStateTransitionId);
		}),
	});
}
