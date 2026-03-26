import { isNonEmptyArray } from "@aikirun/lib/array";
import type { Repositories } from "server/infra/db/types";
import type { WorkflowRunPublisher } from "server/infra/messaging/redis-publisher";
import type { CronContext } from "server/middleware/context";

export interface RepublishStaleRuns {
	repos: Pick<Repositories, "workflowRunOutbox">;
	workflowRunPublisher: WorkflowRunPublisher;
}

export async function republishStaleRuns(
	context: CronContext,
	deps: RepublishStaleRuns,
	options?: { claimMinIdleTimeMs?: number; limit?: number }
) {
	const { claimMinIdleTimeMs = 30_000, limit = 50 } = options ?? {};

	const staleEntries = await deps.repos.workflowRunOutbox.listStalePublished(claimMinIdleTimeMs, limit);
	const staleEntryIds = staleEntries.map((entry) => entry.id);
	if (!isNonEmptyArray(staleEntryIds)) {
		return;
	}

	context.logger.info({ count: staleEntries.length }, "Republishing stale published outbox entries");

	await deps.workflowRunPublisher.publishReadyRuns(
		context,
		staleEntries.map((entry) => ({
			id: entry.workflowRunId,
			name: entry.workflowName,
			versionId: entry.workflowVersionId,
			shard: entry.shard ?? undefined,
		}))
	);

	await deps.repos.workflowRunOutbox.markAsRepublished(staleEntryIds);
}
