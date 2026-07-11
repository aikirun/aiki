import { isNonEmptyArray } from "@aikirun/lib/collection/array";
import type { WorkflowRunClaimReadyRequestV1 } from "@aikirun/types/api/workflow-run";
import { DEFAULT_CLAIM_MIN_IDLE_TIME_MS, type WorkflowRunId } from "@aikirun/types/workflow/run";

import type { Repositories } from "../infra/db/types";
import type { NamespaceRequestContext } from "../middleware/context";

export interface WorkflowRunOutboxServiceDeps {
	repos: Pick<Repositories, "workflowRunOutbox">;
}

export const createWorkflowRunOutboxService = ({ repos }: WorkflowRunOutboxServiceDeps) => ({
	async claimReady(context: NamespaceRequestContext, request: WorkflowRunClaimReadyRequestV1) {
		const workflowRunOutboxRepo = repos.workflowRunOutbox;

		const stolenEntries = await stealStaleClaimed(context, workflowRunOutboxRepo, request);
		let remainingSlots = request.limit - stolenEntries.length;

		const publishedEntries =
			remainingSlots > 0 ? await claimPublished(context, workflowRunOutboxRepo, request, remainingSlots) : [];
		remainingSlots -= publishedEntries.length;

		const pendingEntries =
			remainingSlots > 0
				? await claimPending(context, workflowRunOutboxRepo, {
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
	},

	async reclaim(context: NamespaceRequestContext, workflowRunId: WorkflowRunId) {
		return repos.workflowRunOutbox.reclaim(context.namespaceId, workflowRunId);
	},
});

export type WorkflowRunOutboxService = ReturnType<typeof createWorkflowRunOutboxService>;

async function stealStaleClaimed(
	context: NamespaceRequestContext,
	repo: Repositories["workflowRunOutbox"],
	request: WorkflowRunClaimReadyRequestV1
) {
	const workflows = request.workflows;
	if (!isNonEmptyArray(workflows)) {
		return [];
	}

	return repo.stealStaleClaimed(
		context.namespaceId,
		{ workflows, shards: request.shards },
		request.claimMinIdleTimeMs ?? DEFAULT_CLAIM_MIN_IDLE_TIME_MS,
		request.limit
	);
}

async function claimPublished(
	context: NamespaceRequestContext,
	repo: Repositories["workflowRunOutbox"],
	request: Pick<WorkflowRunClaimReadyRequestV1, "workflows" | "shards">,
	limit: number
) {
	const workflows = request.workflows;
	if (!isNonEmptyArray(workflows)) {
		return [];
	}

	return repo.claimPublished(context.namespaceId, { workflows, shards: request.shards }, limit);
}

async function claimPending(
	context: NamespaceRequestContext,
	repo: Repositories["workflowRunOutbox"],
	request: Pick<WorkflowRunClaimReadyRequestV1, "workflows" | "shards" | "limit">
) {
	const workflows = request.workflows;
	if (!isNonEmptyArray(workflows)) {
		return [];
	}

	return repo.claimPending(context.namespaceId, { workflows, shards: request.shards }, request.limit);
}
