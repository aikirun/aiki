import { isNonEmptyArray } from "@aikirun/lib/array";
import type { WorkflowRunClaimReadyRequestV1 } from "@aikirun/types/api/workflow-run";
import type { WorkflowRunId } from "@aikirun/types/workflow/run";

import type { Repositories } from "../infra/db/types";
import type { NamespaceRequestContext } from "../middleware/context";

export interface WorkflowRunOutboxServiceDeps {
	repos: Pick<Repositories, "workflowRunOutbox">;
}

export function createWorkflowRunOutboxService(deps: WorkflowRunOutboxServiceDeps) {
	const { repos } = deps;

	async function stealStaleClaimed(context: NamespaceRequestContext, request: WorkflowRunClaimReadyRequestV1) {
		const workflows = request.workflows;
		if (!isNonEmptyArray(workflows)) {
			return [];
		}

		return repos.workflowRunOutbox.stealStaleClaimed(
			context.namespaceId,
			{ workflows, shards: request.shards },
			request.claimMinIdleTimeMs,
			request.limit
		);
	}

	async function claimPublished(
		context: NamespaceRequestContext,
		request: Pick<WorkflowRunClaimReadyRequestV1, "workflows" | "shards">,
		limit: number
	) {
		const workflows = request.workflows;
		if (!isNonEmptyArray(workflows)) {
			return [];
		}

		return repos.workflowRunOutbox.claimPublished(context.namespaceId, { workflows, shards: request.shards }, limit);
	}

	async function claimPending(
		context: NamespaceRequestContext,
		request: Pick<WorkflowRunClaimReadyRequestV1, "workflows" | "shards" | "limit">
	) {
		const workflows = request.workflows;
		if (!isNonEmptyArray(workflows)) {
			return [];
		}

		return repos.workflowRunOutbox.claimPending(
			context.namespaceId,
			{ workflows, shards: request.shards },
			request.limit
		);
	}

	async function claimReady(context: NamespaceRequestContext, request: WorkflowRunClaimReadyRequestV1) {
		const stolenEntries = await stealStaleClaimed(context, request);
		let remainingSlots = request.limit - stolenEntries.length;

		const publishedEntries = remainingSlots > 0 ? await claimPublished(context, request, remainingSlots) : [];
		remainingSlots -= publishedEntries.length;

		const pendingEntries =
			remainingSlots > 0
				? await claimPending(context, {
						workflows: request.workflows,
						shards: request.shards,
						limit: remainingSlots,
					})
				: [];

		const runs: Array<{ id: string }> = [];
		for (const entry of stolenEntries) {
			runs.push({ id: entry.workflowRunId });
		}
		for (const entry of publishedEntries) {
			runs.push({ id: entry.workflowRunId });
		}
		for (const entry of pendingEntries) {
			runs.push({ id: entry.workflowRunId });
		}

		return runs;
	}

	async function reclaim(context: NamespaceRequestContext, workflowRunId: WorkflowRunId) {
		return repos.workflowRunOutbox.reclaim(context.namespaceId, workflowRunId);
	}

	return {
		claimReady: claimReady,
		reclaim: reclaim,
	};
}

export type WorkflowRunOutboxService = ReturnType<typeof createWorkflowRunOutboxService>;
