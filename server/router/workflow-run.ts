import type { WorkflowRunId } from "@aikirun/types/workflow-run";
import { runConcurrently } from "server/lib/concurrency";
import type { TaskStateMachineService } from "server/service/task-state-machine";
import type { WorkflowRunService } from "server/service/workflow-run";
import type { WorkflowRunOutboxService } from "server/service/workflow-run-outbox";
import type { WorkflowRunStateMachineService } from "server/service/workflow-run-state-machine";

import { namespaceAuthedImplementer } from "./implementer";

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

	const listV1 = os.listV1.handler(async ({ input: request, context }) => {
		return workflowRunService.listWorkflowRuns(context, request);
	});

	const getByIdV1 = os.getByIdV1.handler(async ({ input: request, context }) => {
		return {
			run: await workflowRunService.getWorkflowRunById(context, request.id),
		};
	});

	const getByReferenceIdV1 = os.getByReferenceIdV1.handler(async ({ input: request, context }) => {
		return {
			run: await workflowRunService.getWorkflowRunByReferenceId(context, request),
		};
	});

	const getStateV1 = os.getStateV1.handler(async ({ input: request, context }) => {
		return {
			state: await workflowRunService.getWorkflowRunState(context, request.id),
		};
	});

	const createV1 = os.createV1.handler(async ({ input: request, context }) => {
		return {
			id: await workflowRunService.createWorkflowRun(context, request),
		};
	});

	const transitionStateV1 = os.transitionStateV1.handler(async ({ input: request, context }) => {
		return workflowRunStateMachineService.transitionState(context, request);
	});

	const transitionTaskStateV1 = os.transitionTaskStateV1.handler(async ({ input: request, context }) => {
		const taskInfo = await taskStateMachineService.transitionState(context, request);
		return { taskInfo };
	});

	const setTaskStateV1 = os.setTaskStateV1.handler(async ({ input: request, context }) => {
		await workflowRunService.setTaskState(context, request);
	});

	const listTransitionsV1 = os.listTransitionsV1.handler(async ({ input: request, context }) => {
		return workflowRunService.listWorkflowRunTransitions(context, request);
	});

	const sendEventV1 = os.sendEventV1.handler(async ({ input: request, context }) => {
		const runId = request.id as WorkflowRunId;
		await workflowRunService.sendEventToWorkflowRun(
			context,
			runId,
			request.eventName,
			request.data,
			request.options?.reference
		);
	});

	const multicastEventV1 = os.multicastEventV1.handler(async ({ input: request, context }) => {
		const runIds = request.ids as WorkflowRunId[];
		const { eventName, data, options } = request;

		await runConcurrently(context, runIds, async (runId, spanCtx) => {
			await workflowRunService.sendEventToWorkflowRun(spanCtx, runId, eventName, data, options?.reference);
		});
	});

	const multicastEventByReferenceV1 = os.multicastEventByReferenceV1.handler(async ({ input: request, context }) => {
		const runIds = await workflowRunService.resolveRunIdsByReferences(context, request.references);
		const { eventName, data, options } = request;

		await runConcurrently(context, runIds, async (runId, spanCtx) => {
			await workflowRunService.sendEventToWorkflowRun(spanCtx, runId, eventName, data, options?.reference);
		});
	});

	const listChildRunsV1 = os.listChildRunsV1.handler(async ({ input: request, context }) => {
		return workflowRunService.listChildRuns(context, request);
	});

	const cancelByIdsV1 = os.cancelByIdsV1.handler(async ({ input: request, context }) => {
		return workflowRunService.cancelByIds(context, request);
	});

	const claimReadyV1 = os.claimReadyV1.handler(async ({ input: request, context }) => {
		return { runs: await workflowRunOutboxService.claimReady(context, request) };
	});

	const heartbeatV1 = os.heartbeatV1.handler(async ({ input: request, context }) => {
		await workflowRunOutboxService.reclaim(context, request.id as WorkflowRunId);
	});

	return os.router({
		listV1,
		getByIdV1,
		getByReferenceIdV1,
		getStateV1,
		createV1,
		transitionStateV1,
		transitionTaskStateV1,
		setTaskStateV1,
		listTransitionsV1,
		sendEventV1,
		multicastEventV1,
		multicastEventByReferenceV1,
		listChildRunsV1,
		cancelByIdsV1,
		claimReadyV1,
		heartbeatV1,
	});
}
