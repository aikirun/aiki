import { isNonEmptyArray } from "@aikirun/lib";
import type { Repositories } from "server/infra/db/types";
import type { WorkflowRunPublisher } from "server/infra/messaging/redis-publisher";
import type { CronContext } from "server/middleware/context";

export interface PublishReadyRunsDeps {
	repos: Pick<Repositories, "workflowRunOutbox">;
	workflowRunPublisher: WorkflowRunPublisher;
}

export async function publishReadyRuns(context: CronContext, deps: PublishReadyRunsDeps, options?: { limit?: number }) {
	const { limit = 100 } = options ?? {};

	const pendingEntries = await deps.repos.workflowRunOutbox.listPending(limit);
	const pendingEntryIds = pendingEntries.map((entry) => entry.id);
	if (!isNonEmptyArray(pendingEntryIds)) {
		return;
	}

	await deps.workflowRunPublisher.publishReadyRuns(
		context,
		pendingEntries.map((entry) => ({
			id: entry.workflowRunId,
			name: entry.workflowName,
			versionId: entry.workflowVersionId,
			shard: entry.shard ?? undefined,
		}))
	);

	await deps.repos.workflowRunOutbox.markPublished(pendingEntryIds);
}
