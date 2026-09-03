import type { WorkflowRunId } from "@aikirun/types/workflow/run";

import { namespaceAuthedImplementer } from "./implementer";
import type { EventService } from "../service/event";
import type { WorkflowRunStateMachine } from "../service/state-machine/workflow-run";
import type { WorkflowRunService } from "../service/workflow-run";
import type { WorkflowRunOutboxService } from "../service/workflow-run-outbox";

export interface WorkflowRunRouterDeps {
	eventService: EventService;
	workflowRunService: WorkflowRunService;
	workflowRunStateMachine: WorkflowRunStateMachine;
	workflowRunOutboxService: WorkflowRunOutboxService;
}

export function createWorkflowRunRouter(deps: WorkflowRunRouterDeps) {
	const os = namespaceAuthedImplementer.workflowRun;
	const { eventService, workflowRunService, workflowRunStateMachine, workflowRunOutboxService } = deps;

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
			return workflowRunStateMachine.transitionState(context, request);
		}),

		listTransitionsV1: os.listTransitionsV1.handler(async ({ input: request, context }) => {
			return workflowRunService.listWorkflowRunTransitions(context, request);
		}),

		sendEventV1: os.sendEventV1.handler(async ({ input: request, context }) => {
			const runId = request.id as WorkflowRunId;
			await eventService.sendEventToWorkflowRun(context, {
				runId,
				eventName: request.eventName,
				data: request.data,
				reference: request.options?.reference,
			});
		}),

		multicastEventV1: os.multicastEventV1.handler(async ({ input: request, context }) => {
			return eventService.multicastEventToWorkflowRuns(context, {
				runIds: request.ids as WorkflowRunId[],
				eventName: request.eventName,
				data: request.data,
				reference: request.options?.reference,
			});
		}),

		multicastEventByReferenceV1: os.multicastEventByReferenceV1.handler(async ({ input: request, context }) => {
			const runIds = await workflowRunService.resolveRunIdsByReferences(context, request.references);

			return eventService.multicastEventToWorkflowRuns(context, {
				runIds,
				eventName: request.eventName,
				data: request.data,
				reference: request.options?.reference,
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
			await workflowRunOutboxService.refreshClaim(context, request.id as WorkflowRunId);
		}),

		hasTerminatedV1: os.hasTerminatedV1.handler(async ({ input: request, context }) => {
			return workflowRunService.hasTerminated(context, request.id, request.afterStateTransitionId);
		}),
	});
}
