import { isNonEmptyArray } from "@aikirun/lib/collection/array";
import type { WorkflowRunClaimReadyRequestV1 } from "@aikirun/types/api/workflow-run";
import type { WorkflowRunId } from "@aikirun/types/workflow/run";

import type { Repositories } from "../infra/db/types";
import type { NamespaceRequestContext } from "../middleware/context";

export interface WorkflowRunOutboxServiceDeps {
	repos: Pick<Repositories, "workflowRunOutbox">;
}

export const createWorkflowRunOutboxService = ({ repos }: WorkflowRunOutboxServiceDeps) => ({
	async claimReady(context: NamespaceRequestContext, request: WorkflowRunClaimReadyRequestV1) {
		const claimedEntries = await claimPending(context, repos.workflowRunOutbox, request);
		return claimedEntries.map((entry) => ({ id: entry.workflowRunId }));
	},

	async refreshClaim(context: NamespaceRequestContext, workflowRunId: WorkflowRunId) {
		return repos.workflowRunOutbox.refreshClaim(context.namespaceId, workflowRunId);
	},
});

export type WorkflowRunOutboxService = ReturnType<typeof createWorkflowRunOutboxService>;

async function claimPending(
	context: NamespaceRequestContext,
	repo: Repositories["workflowRunOutbox"],
	request: WorkflowRunClaimReadyRequestV1
) {
	const { workflows } = request;
	if (!isNonEmptyArray(workflows)) {
		return [];
	}

	return repo.claimPending(context.namespaceId, { workflows, shards: request.shards }, request.limit);
}
