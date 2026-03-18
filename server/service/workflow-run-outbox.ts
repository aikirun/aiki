import { isNonEmptyArray } from "@aikirun/lib";
import type { WorkflowRunId } from "@aikirun/types/workflow-run";
import type { WorkflowRunClaimReadyRequestV1 } from "@aikirun/types/workflow-run-api";
import type { WorkflowRunOutboxRepository } from "server/infra/db/repository/workflow-run-outbox";
import type { NamespaceRequestContext } from "server/middleware/context";

export interface WorkflowRunStateMachineServiceDeps {
	workflowRunOutboxRepo: WorkflowRunOutboxRepository;
}

export function createWorkflowRunOutboxService(deps: WorkflowRunStateMachineServiceDeps) {
	const { workflowRunOutboxRepo } = deps;

	async function claimStalePublished(context: NamespaceRequestContext, request: WorkflowRunClaimReadyRequestV1) {
		const workflows = request.workflows;
		if (!isNonEmptyArray(workflows)) {
			return [];
		}

		return workflowRunOutboxRepo.claimStalePublished(
			context.namespaceId,
			workflows,
			request.claimMinIdleTimeMs,
			request.limit
		);
	}

	async function claimPending(
		context: NamespaceRequestContext,
		request: Pick<WorkflowRunClaimReadyRequestV1, "workflows" | "limit">
	) {
		const workflows = request.workflows;
		if (!isNonEmptyArray(workflows)) {
			return [];
		}

		return workflowRunOutboxRepo.claimPending(context.namespaceId, workflows, request.limit);
	}

	async function claimReady(context: NamespaceRequestContext, request: WorkflowRunClaimReadyRequestV1) {
		const staleEntries = await claimStalePublished(context, request);
		const remainingSlots = request.limit - staleEntries.length;
		const pendingEntries =
			remainingSlots > 0
				? await claimPending(context, {
						workflows: request.workflows,
						limit: remainingSlots,
					})
				: [];

		const runs: Array<{ id: string }> = [];
		for (const entry of staleEntries) {
			runs.push({ id: entry.workflowRunId });
		}
		for (const entry of pendingEntries) {
			runs.push({ id: entry.workflowRunId });
		}

		return runs;
	}

	async function reclaim(context: NamespaceRequestContext, workflowRunId: WorkflowRunId) {
		return workflowRunOutboxRepo.reclaim(context.namespaceId, workflowRunId);
	}

	return {
		claimReady: claimReady,
		reclaim: reclaim,
	};
}

export type WorkflowRunOutboxService = ReturnType<typeof createWorkflowRunOutboxService>;
